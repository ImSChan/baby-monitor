const resources = new Set()
export function registerLiveCleanup(cleanup) {
  resources.add(cleanup)
  return () => resources.delete(cleanup)
}
export function stopAllLiveResources() {
  for (const cleanup of [...resources]) {
    try { cleanup() } catch { /* Continue releasing the other device resources. */ }
  }
}
