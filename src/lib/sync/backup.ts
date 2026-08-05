import JSZip from 'jszip'
import type { CloudSnapshot, SyncNode } from '@webwings/sync-protocol'

export interface LocalBackupBody {
  v: 1
  localRevision: number
  nodes: SyncNode[]
}

export interface CloudBackupBody {
  v: 1
  bindSessionId: string
  cloudSeq: number
  syncEpoch: number
  nodes: SyncNode[]
}

export interface BackupManifest {
  format: 'webwings-sync-backup'
  version: 1
  exportedAt: string
  instanceId: string
  keyPrefix: string
  syncEpoch: number
  cloudSeq: number
  localRevision: number
  counts: { cloud: number; local: number }
  digests: { cloud: string; local: string }
}

export interface BuiltBackup {
  blob: Blob
  filename: string
  manifest: BackupManifest
  cloudJson: string
  localJson: string
  cloudDigest: string
  localDigest: string
}

export const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const dateStamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

/**
 * Serializes the locked cloud snapshot and the captured local snapshot into a
 * `webwings-sync-backup` ZIP containing manifest.json, cloud.json and
 * local.json with SHA-256 digests. Never contains srkey or device credentials.
 */
export const buildBackupArchive = async (args: {
  instanceId: string
  keyPrefix: string
  cloud: CloudSnapshot
  local: { nodes: SyncNode[]; localRevision: number }
}): Promise<BuiltBackup> => {
  const cloudBody: CloudBackupBody = {
    v: 1,
    bindSessionId: args.cloud.bindSessionId,
    cloudSeq: args.cloud.cloudSeq,
    syncEpoch: args.cloud.syncEpoch,
    nodes: args.cloud.nodes,
  }
  const localBody: LocalBackupBody = {
    v: 1,
    localRevision: args.local.localRevision,
    nodes: args.local.nodes,
  }
  const cloudJson = JSON.stringify(cloudBody)
  const localJson = JSON.stringify(localBody)
  const cloudDigest = await sha256Hex(cloudJson)
  const localDigest = await sha256Hex(localJson)
  const manifest: BackupManifest = {
    format: 'webwings-sync-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    instanceId: args.instanceId,
    keyPrefix: args.keyPrefix,
    syncEpoch: args.cloud.syncEpoch,
    cloudSeq: args.cloud.cloudSeq,
    localRevision: args.local.localRevision,
    counts: { cloud: args.cloud.nodes.length, local: args.local.nodes.length },
    digests: { cloud: cloudDigest, local: localDigest },
  }
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest))
  zip.file('cloud.json', cloudJson)
  zip.file('local.json', localJson)
  const blob = await zip.generateAsync({ type: 'blob' })
  const filename = `webwings-sync-backup-${dateStamp()}-${args.instanceId.slice(0, 8)}.zip`
  return { blob, filename, manifest, cloudJson, localJson, cloudDigest, localDigest }
}
