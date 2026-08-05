import { describe, expect, it } from 'vitest'
import {
  parseBackupManifest,
  parseBindComplete,
  parseOperation,
  parsePullResponse,
  parsePushRequest,
  parseServiceInfo,
  parseSyncNode,
} from '../src/schemas'

describe('sync protocol schemas', () => {
  it('accepts a valid service info payload', () => {
    const info = parseServiceInfo({
      service: 'webwings-sync',
      apiVersion: 1,
      instanceId: 'srv_01abc',
      serverTime: '2026-08-05T12:00:00.000Z',
      minClientVersion: '1.1.0',
      features: ['realtime', 'snapshots', 'key-management'],
    })
    expect(info.instanceId).toBe('srv_01abc')
    expect(info.features).toContain('realtime')
  })

  it('rejects a service info with an unknown service name', () => {
    expect(() => parseServiceInfo({
      service: 'other-service',
      apiVersion: 1,
      instanceId: 'srv_1',
      serverTime: '2026-08-05T12:00:00.000Z',
      minClientVersion: '1.1.0',
      features: [],
    })).toThrow()
  })

  it('accepts a create_node operation and rejects unknown operation types', () => {
    const op = parseOperation({
      v: 1,
      opId: 'op-1',
      deviceId: 'dev-1',
      syncEpoch: 1,
      type: 'create_node',
      node: {
        id: 'node-1',
        type: 'bookmark',
        parentId: null,
        title: 'OpenAI',
        url: 'https://openai.com',
        createdAt: '2026-08-05T12:00:00.000Z',
        updatedAt: '2026-08-05T12:00:00.000Z',
      },
    })
    expect(op.type).toBe('create_node')

    expect(() => parseOperation({
      v: 1,
      opId: 'op-2',
      deviceId: 'dev-1',
      syncEpoch: 1,
      type: 'explode',
    })).toThrow()
  })

  it('rejects an operation missing opId and an operation with unknown schema version', () => {
    expect(() => parseOperation({
      v: 1,
      deviceId: 'dev-1',
      syncEpoch: 1,
      type: 'delete_tree',
      nodeId: 'node-1',
    })).toThrow()

    expect(() => parseOperation({
      v: 99,
      opId: 'op-3',
      deviceId: 'dev-1',
      syncEpoch: 1,
      type: 'delete_tree',
      nodeId: 'node-1',
    })).toThrow()
  })

  it('accepts every bind completion strategy', () => {
    for (const strategy of ['initialize_cloud', 'use_cloud', 'use_local', 'merge']) {
      const request = parseBindComplete({
        v: 1,
        operationId: 'bind-op-1',
        strategy,
        localNodes: [],
        expected: { cloudSeq: 0, syncEpoch: 1, localRevision: 7 },
      })
      expect(request.strategy).toBe(strategy)
    }
  })

  it('rejects an unknown bind strategy and an unexpected schema version', () => {
    expect(() => parseBindComplete({
      v: 1,
      operationId: 'bind-op-2',
      strategy: 'nuke_everything',
      localNodes: [],
      expected: { cloudSeq: 0, syncEpoch: 1, localRevision: 1 },
    })).toThrow()

    expect(() => parseBindComplete({
      v: 2,
      operationId: 'bind-op-3',
      strategy: 'merge',
      localNodes: [],
      expected: { cloudSeq: 0, syncEpoch: 1, localRevision: 1 },
    })).toThrow()
  })

  it('accepts a valid backup manifest and rejects the wrong format', () => {
    const manifest = parseBackupManifest({
      format: 'webwings-sync-backup',
      version: 1,
      exportedAt: '2026-08-05T12:00:00.000Z',
      instanceId: 'srv_1',
      keyPrefix: 'srk_sync_abc',
      syncEpoch: 1,
      cloudSeq: 0,
      localRevision: 3,
      counts: { cloud: 0, local: 2 },
      digests: {
        cloud: '0'.repeat(64),
        local: '1'.repeat(64),
      },
    })
    expect(manifest.localRevision).toBe(3)

    expect(() => parseBackupManifest({
      format: 'webwings-bookmarks',
      version: 1,
      exportedAt: '2026-08-05T12:00:00.000Z',
      instanceId: 'srv_1',
      keyPrefix: 'srk_sync_abc',
      syncEpoch: 1,
      cloudSeq: 0,
      localRevision: 3,
      counts: { cloud: 0, local: 2 },
      digests: { cloud: 'a', local: 'b' },
    })).toThrow()
  })

  it('rejects bookmark nodes with unsafe URL protocols', () => {
    expect(() => parseSyncNode({
      id: 'node-1',
      type: 'bookmark',
      parentId: null,
      title: 'bad',
      url: 'javascript:alert(1)',
      positionKey: '000000000000000000000001',
      createdAt: '2026-08-05T12:00:00.000Z',
      updatedAt: '2026-08-05T12:00:00.000Z',
      version: 1,
      deletedAt: null,
      recoveryReason: null,
    })).toThrow()
  })

  it('distinguishes snapshot_required from ok pull responses', () => {
    const ok = parsePullResponse({ v: 1, status: 'ok', epoch: 1, currentSeq: 5, events: [] })
    expect(ok.status).toBe('ok')

    const required = parsePullResponse({ v: 1, status: 'snapshot_required', epoch: 2, currentSeq: 9, snapshotSeq: 8 })
    expect(required.status).toBe('snapshot_required')
    if (required.status === 'snapshot_required') {
      expect(required.snapshotSeq).toBe(8)
    }
  })

  it('validates a push request batch and its receipts', () => {
    const request = parsePushRequest({
      v: 1,
      ops: [{
        v: 1,
        opId: 'op-1',
        deviceId: 'dev-1',
        syncEpoch: 1,
        type: 'create_node',
        node: {
          id: 'node-1',
          type: 'folder',
          parentId: null,
          title: '工作',
          createdAt: '2026-08-05T12:00:00.000Z',
          updatedAt: '2026-08-05T12:00:00.000Z',
        },
      }],
    })
    expect(request.ops).toHaveLength(1)
  })
})
