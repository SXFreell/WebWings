export const PROTOCOL_SERVICE = 'webwings-sync'
export const PROTOCOL_VERSION = 1
export const PROTOCOL_MIN_CLIENT_VERSION = '1.1.0'

export type KeyRole = 'admin' | 'sync'
export type KeyStatus = 'active' | 'pending_delete'

export interface ServiceInfo {
  service: typeof PROTOCOL_SERVICE
  apiVersion: typeof PROTOCOL_VERSION
  instanceId: string
  serverTime: string
  minClientVersion: string
  features: string[]
}

export interface SyncNode {
  id: string
  type: 'folder' | 'bookmark'
  parentId: string | null
  title: string
  url?: string
  favicon?: string
  positionKey: string
  createdAt: string
  updatedAt: string
  version: number
  deletedAt: string | null
  recoveryReason: string | null
}

export interface SyncNodeCreateInput {
  id: string
  type: 'folder' | 'bookmark'
  parentId: string | null
  title: string
  url?: string
  favicon?: string
  positionKey?: string
  createdAt: string
  updatedAt: string
}

export interface NodePatch {
  title?: string
  url?: string
  favicon?: string
}

export type SyncOperation =
  | {
      v: 1
      opId: string
      deviceId: string
      syncEpoch: number
      type: 'create_node'
      node: SyncNodeCreateInput
    }
  | {
      v: 1
      opId: string
      deviceId: string
      syncEpoch: number
      type: 'patch_node'
      nodeId: string
      baseVersion: number
      patch: NodePatch
    }
  | {
      v: 1
      opId: string
      deviceId: string
      syncEpoch: number
      type: 'move_node'
      nodeId: string
      newParentId: string | null
    }
  | {
      v: 1
      opId: string
      deviceId: string
      syncEpoch: number
      type: 'delete_tree'
      nodeId: string
    }
  | {
      v: 1
      opId: string
      deviceId: string
      syncEpoch: number
      type: 'restore_node'
      nodeId: string
    }
  | {
      v: 1
      opId: string
      deviceId: string
      syncEpoch: number
      type: 'import_nodes'
      nodes: SyncNodeCreateInput[]
    }

export type OperationReceiptStatus = 'accepted' | 'rejected' | 'epoch_mismatch'

export interface OperationReceipt {
  opId: string
  status: OperationReceiptStatus
  seq: number | null
  errorCode?: string
  errorMessage?: string
}

export interface PushRequest {
  v: 1
  ops: SyncOperation[]
}

export interface PushResponse {
  v: 1
  receipts: OperationReceipt[]
}

export type SyncEventType =
  | 'created'
  | 'patched'
  | 'moved'
  | 'deleted'
  | 'restored'
  | 'imported'
  | 'epoch_reset'
  | 'positions_rebalanced'

export interface SyncEvent {
  syncEpoch: number
  seq: number
  opId: string
  deviceId: string
  type: SyncEventType
  payload: unknown
  createdAt: string
}

export type PullResponse =
  | {
      v: 1
      status: 'ok'
      epoch: number
      currentSeq: number
      events: SyncEvent[]
    }
  | {
      v: 1
      status: 'snapshot_required'
      epoch: number
      currentSeq: number
      snapshotSeq: number
    }

export interface SnapshotPayload {
  v: 1
  epoch: number
  seq: number
  digest: string
  nodes: SyncNode[]
}

export interface BindStartRequest {
  v: 1
  srkey: string
  deviceName?: string
  deviceInfo?: string
}

export interface BindStartResponse {
  v: 1
  bindSessionId: string
  bindToken: string
  expiresAt: string
  keyId: string
  keyPrefix: string
  role: KeyRole
  capabilities: string[]
  cloud: {
    hasData: boolean
    cloudSeq: number
    syncEpoch: number
  }
}

export interface CloudSnapshot {
  v: 1
  bindSessionId: string
  cloudSeq: number
  syncEpoch: number
  digest: string
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
  counts: {
    cloud: number
    local: number
  }
  digests: {
    cloud: string
    local: string
  }
}

export interface BackupProof {
  v: 1
  bindSessionId: string
  cloudDigest: string
  localDigest: string
  localRevision: number
  downloadState: 'complete'
  downloadedAt: string
}

export type BindStrategy = 'initialize_cloud' | 'use_cloud' | 'use_local' | 'merge'

export interface BindCompleteRequest {
  v: 1
  operationId: string
  strategy: BindStrategy
  localNodes: SyncNodeCreateInput[]
  expected: {
    cloudSeq: number
    syncEpoch: number
    localRevision: number
  }
}

export interface DeviceSession {
  deviceId: string
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: string
  refreshTokenExpiresAt: string
}

export interface BindCompleteResponse {
  v: 1
  deviceSession: DeviceSession
  snapshot: SnapshotPayload
}

export interface AdminKeySummary {
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

export interface AdminCreateKeyResponse {
  keyId: string
  keyPrefix: string
  srkey: string
  label: string | null
}

export interface AdminRotateKeyResponse {
  keyId: string
  keyPrefix: string
  srkey: string
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}
