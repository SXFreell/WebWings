import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { CloudSnapshot, SyncNode } from '@webwings/sync-protocol'
import { buildBackupArchive, sha256Hex } from './backup'

const node = (id: string, overrides: Partial<SyncNode> = {}): SyncNode => ({
  id,
  type: 'bookmark',
  parentId: null,
  title: id,
  url: 'https://example.com',
  positionKey: '1000',
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
  version: 1,
  deletedAt: null,
  recoveryReason: null,
  ...overrides,
})

const cloud = (nodes: SyncNode[], overrides: Partial<CloudSnapshot> = {}): CloudSnapshot => ({
  v: 1,
  bindSessionId: 'bind-1',
  cloudSeq: 5,
  syncEpoch: 1,
  digest: 'c'.repeat(64),
  nodes,
  ...overrides,
})

describe('sync backup archive', () => {
  it('serializes manifest.json, cloud.json and local.json with matching digests', async () => {
    const archive = await buildBackupArchive({
      instanceId: 'srv_01',
      keyPrefix: 'srk_sync_ab',
      cloud: cloud([node('c1')]),
      local: { nodes: [node('l1')], localRevision: 7 },
    })

    expect(archive.manifest).toMatchObject({
      format: 'webwings-sync-backup',
      version: 1,
      instanceId: 'srv_01',
      keyPrefix: 'srk_sync_ab',
      syncEpoch: 1,
      cloudSeq: 5,
      localRevision: 7,
      counts: { cloud: 1, local: 1 },
      digests: { cloud: archive.cloudDigest, local: archive.localDigest },
    })
    expect(archive.cloudDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(archive.localDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(archive.cloudDigest).toBe(await sha256Hex(archive.cloudJson))
    expect(archive.localDigest).toBe(await sha256Hex(archive.localJson))

    const zip = await JSZip.loadAsync(await archive.blob.arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual(['cloud.json', 'local.json', 'manifest.json'])
    expect(await zip.file('cloud.json')!.async('string')).toBe(archive.cloudJson)
    expect(await zip.file('local.json')!.async('string')).toBe(archive.localJson)
    expect(await zip.file('manifest.json')!.async('string')).toBe(JSON.stringify(archive.manifest))
  })

  it('never includes srkey or device credentials in the archive', async () => {
    const archive = await buildBackupArchive({
      instanceId: 'srv_01',
      keyPrefix: 'srk_sync_ab',
      cloud: cloud([node('c1')]),
      local: { nodes: [node('l1')], localRevision: 3 },
    })
    const zip = await JSZip.loadAsync(await archive.blob.arrayBuffer())
    const all = await Promise.all(
      ['manifest.json', 'cloud.json', 'local.json'].map((name) => zip.file(name)!.async('string')),
    )
    const contents = all.join('\n')
    expect(contents).not.toMatch(/srk_(admin|sync)_[A-Za-z0-9_-]{20,}/)
    expect(contents).not.toMatch(/srkey|accessToken|refreshToken|bindToken/i)
  })

  it('embeds both snapshots so either side can be restored independently', async () => {
    const archive = await buildBackupArchive({
      instanceId: 'srv_01',
      keyPrefix: 'srk_sync_ab',
      cloud: cloud([node('c1'), node('c2')]),
      local: { nodes: [node('l1')], localRevision: 2 },
    })
    const zip = await JSZip.loadAsync(await archive.blob.arrayBuffer())
    const cloudJson = JSON.parse(await zip.file('cloud.json')!.async('string'))
    const localJson = JSON.parse(await zip.file('local.json')!.async('string'))
    expect(cloudJson.nodes).toHaveLength(2)
    expect(cloudJson.bindSessionId).toBe('bind-1')
    expect(localJson.nodes).toHaveLength(1)
    expect(localJson.localRevision).toBe(2)
  })
})
