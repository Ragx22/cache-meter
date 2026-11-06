export type Meter = {
  /** When the last main-thread response arrived; null while nothing is cached. */
  cacheAt: number | null
  ttlMs: number
  /** Share of the last response's input tokens read from the cache, 0 to 100. */
  hit: number | null
  /** Context window fill, 0 to 100. */
  percent: number
  /** Where auto-compaction runs, as a percentage of the window. */
  threshold: number
  /** False while `threshold` is the 83% fallback rather than the session's. */
  isThresholdRead: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'cache-meter': { meter: Meter; tick: number; isCollapsed: boolean }
  }
}
