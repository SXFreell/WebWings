export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const SENSITIVE_KEY = /(authorization|srkey|secret|password|cookie|token|backup)/i

export const redact = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => redact(item, seen))
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item, seen)
  }
  return output
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
}

export const createLogger = (
  level: LogLevel = 'info',
  stream: NodeJS.WritableStream = process.stdout,
): Logger => {
  const write = (logLevel: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[logLevel] < LEVEL_ORDER[level]) return
    const record = {
      time: new Date().toISOString(),
      level: logLevel,
      message,
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    }
    stream.write(`${JSON.stringify(record)}\n`)
  }
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  }
}
