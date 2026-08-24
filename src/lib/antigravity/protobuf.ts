/**
 * Minimal protobuf wire-format reader.
 *
 * Antigravity stores its state as protobuf with no published schema, so this
 * reads the wire format structurally (field number + wire type) without needing
 * a .proto. Every consumer must treat the result as untrusted and optional.
 */

export type WireValue =
  | { field: number; type: 'varint'; value: number }
  | { field: number; type: 'bytes'; value: Uint8Array }
  | { field: number; type: 'fixed32' | 'fixed64'; value: Uint8Array };

function readVarint(buf: Uint8Array, i: number): [number, number] {
  let result = 0;
  let shift = 0;
  while (i < buf.length) {
    const b = buf[i++];
    result += (b & 0x7f) * Math.pow(2, shift);
    if ((b & 0x80) === 0) return [result, i];
    shift += 7;
    if (shift > 63) break;
  }
  throw new Error('truncated varint');
}

/** Parse one message into its top-level fields. Stops at the first bad byte. */
export function readFields(buf: Uint8Array): WireValue[] {
  const out: WireValue[] = [];
  let i = 0;
  while (i < buf.length) {
    let tag: number;
    try {
      [tag, i] = readVarint(buf, i);
    } catch {
      break;
    }
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 0) break;
    try {
      if (wire === 0) {
        const [v, ni] = readVarint(buf, i);
        i = ni;
        out.push({ field, type: 'varint', value: v });
      } else if (wire === 2) {
        const [len, ni] = readVarint(buf, i);
        i = ni;
        if (i + len > buf.length) break;
        out.push({ field, type: 'bytes', value: buf.subarray(i, i + len) });
        i += len;
      } else if (wire === 5) {
        if (i + 4 > buf.length) break;
        out.push({ field, type: 'fixed32', value: buf.subarray(i, i + 4) });
        i += 4;
      } else if (wire === 1) {
        if (i + 8 > buf.length) break;
        out.push({ field, type: 'fixed64', value: buf.subarray(i, i + 8) });
        i += 8;
      } else {
        break; // groups (3/4) are not used here
      }
    } catch {
      break;
    }
  }
  return out;
}

export function fieldsByNumber(buf: Uint8Array): Map<number, WireValue[]> {
  const m = new Map<number, WireValue[]>();
  for (const f of readFields(buf)) {
    const arr = m.get(f.field) ?? [];
    arr.push(f);
    m.set(f.field, arr);
  }
  return m;
}

export function asString(v: WireValue | undefined): string | null {
  if (!v || v.type !== 'bytes') return null;
  try {
    return new TextDecoder('utf8', { fatal: false }).decode(v.value);
  } catch {
    return null;
  }
}

export function asBytes(v: WireValue | undefined): Uint8Array | null {
  return v && v.type === 'bytes' ? v.value : null;
}

/** google.protobuf.Timestamp → epoch milliseconds. */
export function asTimestampMs(v: WireValue | undefined): number | null {
  const b = asBytes(v);
  if (!b) return null;
  const f = fieldsByNumber(b);
  const secs = f.get(1)?.[0];
  if (!secs || secs.type !== 'varint') return null;
  const nanos = f.get(2)?.[0];
  const ns = nanos && nanos.type === 'varint' ? nanos.value : 0;
  const ms = secs.value * 1000 + Math.floor(ns / 1e6);
  // Reject anything outside a plausible range rather than charting a bad date.
  if (ms < 946_684_800_000 || ms > Date.now() + 86_400_000) return null;
  return ms;
}
