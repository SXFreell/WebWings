export const POSITION_WIDTH = 40
export const POSITION_GAP = 1_000_000_000_000n
const MAX_POSITION = 10n ** BigInt(POSITION_WIDTH)

export const fromPosition = (position: string): bigint => {
  if (!/^\d+$/.test(position)) throw new Error(`invalid position key: ${position}`)
  return BigInt(position)
}

export const toPosition = (value: bigint): string => {
  if (value < 0n) throw new Error('position cannot be negative')
  if (value >= MAX_POSITION) throw new Error('position overflow')
  return value.toString().padStart(POSITION_WIDTH, '0')
}

export const comparePositions = (a: string, b: string): number => {
  const diff = fromPosition(a) - fromPosition(b)
  return diff < 0n ? -1 : diff > 0n ? 1 : 0
}

export const nextPosition = (siblings: string[]): string => {
  const max = siblings.length ? fromPosition(siblings.reduce((a, b) => (comparePositions(a, b) >= 0 ? a : b))) : 0n
  return toPosition(max + POSITION_GAP)
}

export const midPosition = (lower: string | null, upper: string | null): string => {
  if (lower === null && upper === null) return toPosition(POSITION_GAP)
  if (lower === null) {
    const upperValue = fromPosition(upper!)
    return toPosition(upperValue / 2n)
  }
  if (upper === null) return nextPosition([lower])
  const lowerValue = fromPosition(lower)
  const upperValue = fromPosition(upper)
  if (upperValue - lowerValue <= 1n) throw new Error('no position gap between neighbors')
  return toPosition((lowerValue + upperValue) / 2n)
}

export const rebalancePositions = (orderedIds: string[]): Map<string, string> => {
  const result = new Map<string, string>()
  orderedIds.forEach((id, index) => {
    result.set(id, toPosition(POSITION_GAP * BigInt(index + 1)))
  })
  return result
}
