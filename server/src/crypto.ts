import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

export type SrkeyRole = 'admin' | 'sync'

export const generateSrkey = (role: SrkeyRole): string =>
  `srk_${role}_${randomBytes(32).toString('base64url')}`

export const keyPrefix = (rawSrkey: string): string => {
  if (!rawSrkey.startsWith('srk_')) throw new Error('invalid srkey format')
  return rawSrkey.slice(0, 16)
}

export interface ParsedSrkey {
  role: SrkeyRole
  prefix: string
  body: string
}

const SRKEY_BODY = /^[A-Za-z0-9_-]{43}$/

/** Parses and validates the full srkey shape; throws on malformed input. */
export const parseSrkey = (rawSrkey: string): ParsedSrkey => {
  if (typeof rawSrkey !== 'string') throw new Error('invalid srkey format')
  const match = /^srk_(admin|sync)_([A-Za-z0-9_-]+)$/.exec(rawSrkey)
  if (!match) throw new Error('invalid srkey format')
  const [, role, body] = match
  if (!SRKEY_BODY.test(body)) throw new Error('invalid srkey format')
  return { role: role as SrkeyRole, prefix: rawSrkey.slice(0, 16), body }
}

export const hashSrkey = (pepper: string, rawSrkey: string): string =>
  createHmac('sha256', pepper).update(rawSrkey).digest('hex')

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export const randomToken = (): string => randomBytes(32).toString('base64url')

export const newId = (): string => randomUUID()

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

export const constantTimeEqual = (a: string, b: string): boolean => {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return timingSafeEqual(aBuffer, bBuffer)
}
