import type { KeyRole, KeyStatus } from '@webwings/sync-protocol'

export interface NamespaceRow {
  id: string
  syncEpoch: number
  currentSeq: number
  initializedAt: string | null
  createdAt: string
}

export interface AccessKeyRow {
  id: string
  namespaceId: string
  keyPrefix: string
  secretHash: string
  role: KeyRole
  status: KeyStatus
  label: string | null
  tokenVersion: number
  createdAt: string
  revokedAt: string | null
  purgeAt: string | null
  lastUsedAt: string | null
}

export interface DeviceRow {
  id: string
  keyId: string
  name: string | null
  info: string | null
  createdAt: string
  lastSeenAt: string | null
}

export interface DeviceSessionLookup {
  sessionId: string
  deviceId: string
  deviceName: string | null
  keyId: string
  keyPrefix: string
  namespaceId: string
  role: KeyRole
  keyStatus: KeyStatus
  keyTokenVersion: number
  currentKeyTokenVersion: number
  accessExpiresAt: string
  refreshExpiresAt: string
  revokedAt: string | null
}

export interface NodeRow {
  namespaceId: string
  id: string
  type: 'folder' | 'bookmark'
  parentId: string
  title: string
  url: string | null
  favicon: string | null
  positionKey: string
  version: number
  fieldVersions: Record<string, number>
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deleteBatchId: string | null
  recoveryReason: string | null
}

export interface SyncEventRow {
  namespaceId: string
  syncEpoch: number
  seq: number
  opId: string
  deviceId: string | null
  eventType: string
  payload: unknown
  createdAt: string
}

export interface OperationReceiptRow {
  namespaceId: string
  opId: string
  seq: number | null
  status: 'accepted' | 'rejected' | 'epoch_mismatch'
  errorCode: string | null
  payload: unknown
  createdAt: string
}

export interface SnapshotRow {
  namespaceId: string
  syncEpoch: number
  seq: number
  digest: string
  payload: unknown
  createdAt: string
}

export interface BindSessionRow {
  id: string
  keyId: string
  deviceId: string
  bindTokenHash: string
  syncEpoch: number
  cloudSeq: number
  cloudDigest: string | null
  cloudHasData: boolean
  cloudSnapshot: unknown
  state: 'created' | 'backup_proven' | 'completed' | 'expired'
  localRevision: number | null
  localDigest: string | null
  strategy: string | null
  operationId: string | null
  completedEpoch: number | null
  completedSeq: number | null
  expiresAt: string
  createdAt: string
}

export interface AdminKeySummaryRow {
  keyId: string
  keyPrefix: string
  role: KeyRole
  status: KeyStatus
  label: string | null
  deviceCount: number
  nodeCount: number
  createdAt: string
  lastUsedAt: string | null
  purgeAt: string | null
}
