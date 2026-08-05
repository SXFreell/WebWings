export const canonicalJson = (value: unknown): string => JSON.stringify(value, Object.keys(value ?? {}).sort())

export const toIso = (date: Date): string => date.toISOString()
