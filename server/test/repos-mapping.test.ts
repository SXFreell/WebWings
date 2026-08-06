import { describe, expect, it } from 'vitest'
import { toBindSessionRow } from '../src/repos/bindSessions'
import { toNamespaceRow } from '../src/repos/namespaces'

describe('repo bigint row mapping', () => {
  it('coerces namespace currentSeq from pg bigint strings to numbers', () => {
    const row = toNamespaceRow({
      id: 'ns-1',
      syncEpoch: 1,
      currentSeq: '0',
      initializedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(row.currentSeq).toBe(0)
    expect(row.syncEpoch).toBe(1)
  })

  it('coerces bind session bigint fields and keeps nulls nullable', () => {
    const row = toBindSessionRow({
      id: 'bind-1',
      keyId: 'key-1',
      deviceId: 'dev-1',
      bindTokenHash: 'hash',
      syncEpoch: 1,
      cloudSeq: '0',
      cloudDigest: null,
      cloudHasData: false,
      cloudSnapshot: [],
      state: 'backup_proven',
      localRevision: '3',
      localDigest: null,
      strategy: null,
      operationId: null,
      completedEpoch: null,
      completedSeq: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(row.cloudSeq).toBe(0)
    expect(row.localRevision).toBe(3)
    expect(row.completedSeq).toBeNull()
    expect(row.syncEpoch).toBe(1)
  })

  it('coerces a present completedSeq to a number', () => {
    const row = toBindSessionRow({
      id: 'bind-2',
      keyId: 'key-1',
      deviceId: 'dev-1',
      bindTokenHash: 'hash',
      syncEpoch: 1,
      cloudSeq: 1,
      cloudDigest: null,
      cloudHasData: true,
      cloudSnapshot: [],
      state: 'completed',
      localRevision: null,
      localDigest: null,
      strategy: 'initialize_cloud',
      operationId: 'op-1',
      completedEpoch: 1,
      completedSeq: '1',
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(row.completedSeq).toBe(1)
  })
})
