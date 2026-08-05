export interface RateLimiterOptions {
  windowMs: number
  max: number
}

export interface RateLimiter {
  check(key: string): boolean
  reset(key: string): void
}

/** Small in-memory sliding-window rate limiter for bind attempts. */
export const createRateLimiter = (options: RateLimiterOptions): RateLimiter => {
  const attempts = new Map<string, number[]>()
  const now = () => Date.now()
  const prune = (key: string) => {
    const list = attempts.get(key)
    if (!list) return
    const cutoff = now() - options.windowMs
    const kept = list.filter((timestamp) => timestamp > cutoff)
    if (kept.length === 0) attempts.delete(key)
    else attempts.set(key, kept)
  }
  return {
    check(key: string): boolean {
      prune(key)
      const list = attempts.get(key) ?? []
      if (list.length >= options.max) return false
      list.push(now())
      attempts.set(key, list)
      return true
    },
    reset(key: string) {
      attempts.delete(key)
    },
  }
}
