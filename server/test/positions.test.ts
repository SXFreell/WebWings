import { describe, expect, it } from 'vitest'
import {
  comparePositions,
  midPosition,
  nextPosition,
  rebalancePositions,
  toPosition,
} from '../src/positions'

describe('position keys', () => {
  it('appends increasing positions after existing siblings', () => {
    const first = toPosition(1_000_000_000_000n)
    const second = nextPosition([first])
    const third = nextPosition([first, second])
    expect(comparePositions(first, second)).toBeLessThan(0)
    expect(comparePositions(second, third)).toBeLessThan(0)
  })

  it('inserts positions between neighbors', () => {
    const lower = toPosition(2_000_000_000_000n)
    const upper = toPosition(3_000_000_000_000n)
    const middle = midPosition(lower, upper)
    expect(comparePositions(lower, middle)).toBeLessThan(0)
    expect(comparePositions(middle, upper)).toBeLessThan(0)
  })

  it('throws when no integer position remains between neighbors', () => {
    const lower = toPosition(5n)
    const upper = toPosition(6n)
    expect(() => midPosition(lower, upper)).toThrow('no position gap')
  })

  it('rebalances in the given order while preserving relative order', () => {
    const positions = rebalancePositions(['a', 'b', 'c'])
    expect(comparePositions(positions.get('a')!, positions.get('b')!)).toBeLessThan(0)
    expect(comparePositions(positions.get('b')!, positions.get('c')!)).toBeLessThan(0)
    expect(comparePositions(positions.get('a')!, positions.get('c')!)).toBeLessThan(0)
  })
})
