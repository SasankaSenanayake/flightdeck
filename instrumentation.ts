export async function register() {
  // Node runtime only: the collector spawns processes and touches SQLite.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startCollector } = await import('@/lib/system/collector');
  startCollector();
}
