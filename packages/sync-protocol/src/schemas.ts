import { z } from 'zod'
import { PROTOCOL_MIN_CLIENT_VERSION, PROTOCOL_SERVICE, PROTOCOL_VERSION } from './types'
import type {
  BackupManifest,
  BindCompleteRequest,
  PushRequest,
  PullResponse,
  ServiceInfo,
  SyncNode,
} from './types'

export class ProtocolError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ProtocolError'
    this.code = code
  }
}

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'invalid ISO date',
})

const httpUrl = z.string().refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}, 'URL must use http or https')

const nodeType = z.enum(['folder', 'bookmark'])
const idString = z.string().min(1)
const syncEpoch = z.number().int().min(1)
const seqNumber = z.number().int().min(0)

export const syncNodeCreateInputSchema = z.object({
  id: idString,
  type: nodeType,
  parentId: z.string().min(1).nullable(),
  title: z.string().min(1),
  url: httpUrl.optional(),
  favicon: z.string().optional(),
  positionKey: z.string().min(1).optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
})

export const syncNodeSchema = z.object({
  id: idString,
  type: nodeType,
  parentId: z.string().min(1).nullable(),
  title: z.string().min(1),
  url: httpUrl.optional(),
  favicon: z.string().optional(),
  positionKey: z.string().min(1),
  createdAt: isoDate,
  updatedAt: isoDate,
  version: z.number().int().min(0),
  deletedAt: isoDate.nullable(),
  recoveryReason: z.string().nullable(),
})

const operationBase = {
  v: z.literal(1),
  opId: idString,
  deviceId: idString,
  syncEpoch,
}

const createNodeSchema = z.object({
  ...operationBase,
  type: z.literal('create_node'),
  node: syncNodeCreateInputSchema,
})

const patchNodeSchema = z.object({
  ...operationBase,
  type: z.literal('patch_node'),
  nodeId: idString,
  baseVersion: z.number().int().min(0),
  patch: z
    .object({
      title: z.string().min(1).optional(),
      url: httpUrl.optional(),
      favicon: z.string().optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0, 'empty patch'),
})

const moveNodeSchema = z.object({
  ...operationBase,
  type: z.literal('move_node'),
  nodeId: idString,
  newParentId: z.string().min(1).nullable(),
})

const deleteTreeSchema = z.object({
  ...operationBase,
  type: z.literal('delete_tree'),
  nodeId: idString,
})

const restoreNodeSchema = z.object({
  ...operationBase,
  type: z.literal('restore_node'),
  nodeId: idString,
})

const importNodesSchema = z.object({
  ...operationBase,
  type: z.literal('import_nodes'),
  nodes: z.array(syncNodeCreateInputSchema).min(1),
})

export const syncOperationSchema = z.discriminatedUnion('type', [
  createNodeSchema,
  patchNodeSchema,
  moveNodeSchema,
  deleteTreeSchema,
  restoreNodeSchema,
  importNodesSchema,
])

export const syncEventSchema = z.object({
  syncEpoch,
  seq: seqNumber,
  opId: idString,
  deviceId: idString,
  type: z.enum([
    'created',
    'patched',
    'moved',
    'deleted',
    'restored',
    'imported',
    'epoch_reset',
    'positions_rebalanced',
  ]),
  payload: z.unknown(),
  createdAt: isoDate,
})

export const serviceInfoSchema = z.object({
  service: z.literal(PROTOCOL_SERVICE),
  apiVersion: z.literal(PROTOCOL_VERSION),
  instanceId: idString,
  serverTime: isoDate,
  minClientVersion: z.string().min(1),
  features: z.array(z.string()),
})

export const pushRequestSchema = z.object({
  v: z.literal(1),
  ops: z.array(syncOperationSchema).min(1).max(200),
})

export const operationReceiptSchema = z.object({
  opId: idString,
  status: z.enum(['accepted', 'rejected', 'epoch_mismatch']),
  seq: seqNumber.nullable(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
})

export const pushResponseSchema = z.object({
  v: z.literal(1),
  receipts: z.array(operationReceiptSchema),
})

export const pullResponseSchema = z.discriminatedUnion('status', [
  z.object({
    v: z.literal(1),
    status: z.literal('ok'),
    epoch: syncEpoch,
    currentSeq: seqNumber,
    events: z.array(syncEventSchema),
  }),
  z.object({
    v: z.literal(1),
    status: z.literal('snapshot_required'),
    epoch: syncEpoch,
    currentSeq: seqNumber,
    snapshotSeq: seqNumber,
  }),
])

export const snapshotSchema = z.object({
  v: z.literal(1),
  epoch: syncEpoch,
  seq: seqNumber,
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  nodes: z.array(syncNodeSchema),
})

export const bindStartRequestSchema = z.object({
  v: z.literal(1),
  srkey: z.string().min(1),
  deviceName: z.string().optional(),
  deviceInfo: z.string().optional(),
})

export const bindStartResponseSchema = z.object({
  v: z.literal(1),
  bindSessionId: idString,
  bindToken: idString,
  expiresAt: isoDate,
  keyId: idString,
  keyPrefix: idString,
  role: z.enum(['admin', 'sync']),
  capabilities: z.array(z.string()),
  cloud: z.object({
    hasData: z.boolean(),
    cloudSeq: seqNumber,
    syncEpoch: syncEpoch,
  }),
})

export const cloudSnapshotSchema = z.object({
  v: z.literal(1),
  bindSessionId: idString,
  cloudSeq: seqNumber,
  syncEpoch: syncEpoch,
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  nodes: z.array(syncNodeSchema),
})

export const backupManifestSchema = z.object({
  format: z.literal('webwings-sync-backup'),
  version: z.literal(1),
  exportedAt: isoDate,
  instanceId: idString,
  keyPrefix: idString,
  syncEpoch: syncEpoch,
  cloudSeq: seqNumber,
  localRevision: seqNumber,
  counts: z.object({
    cloud: seqNumber,
    local: seqNumber,
  }),
  digests: z.object({
    cloud: z.string().regex(/^[0-9a-f]{64}$/),
    local: z.string().regex(/^[0-9a-f]{64}$/),
  }),
})

export const backupProofSchema = z.object({
  v: z.literal(1),
  bindSessionId: idString,
  cloudDigest: z.string().regex(/^[0-9a-f]{64}$/),
  localDigest: z.string().regex(/^[0-9a-f]{64}$/),
  localRevision: seqNumber,
  downloadState: z.literal('complete'),
  downloadedAt: isoDate,
})

export const bindCompleteRequestSchema = z.object({
  v: z.literal(1),
  operationId: idString,
  strategy: z.enum(['initialize_cloud', 'use_cloud', 'use_local', 'merge']),
  localNodes: z.array(syncNodeCreateInputSchema).max(5000),
  expected: z.object({
    cloudSeq: seqNumber,
    syncEpoch: syncEpoch,
    localRevision: seqNumber,
  }),
})

export const deviceSessionSchema = z.object({
  deviceId: idString,
  accessToken: idString,
  refreshToken: idString,
  accessTokenExpiresAt: isoDate,
  refreshTokenExpiresAt: isoDate,
})

export const bindCompleteResponseSchema = z.object({
  v: z.literal(1),
  deviceSession: deviceSessionSchema,
  snapshot: snapshotSchema,
})

export const adminKeySummarySchema = z.object({
  keyId: idString,
  keyPrefix: idString,
  role: z.enum(['admin', 'sync']),
  status: z.enum(['active', 'pending_delete']),
  label: z.string().nullable(),
  deviceCount: seqNumber,
  nodeCount: seqNumber,
  createdAt: isoDate,
  lastUsedAt: isoDate.nullable(),
  purgeAt: isoDate.nullable(),
})

export const adminCreateKeyResponseSchema = z.object({
  keyId: idString,
  keyPrefix: idString,
  srkey: idString,
  label: z.string().nullable(),
})

export const adminRotateKeyResponseSchema = z.object({
  keyId: idString,
  keyPrefix: idString,
  srkey: idString,
})

const checked = <T>(schema: z.ZodType<T>, input: unknown, code: string): T => {
  const result = schema.safeParse(input)
  if (!result.success) {
    const first = result.error.issues[0]
    const message = first ? `${first.path.join('.')}: ${first.message}` : 'invalid payload'
    throw new ProtocolError(code, message)
  }
  return result.data
}

export const parseServiceInfo = (input: unknown): ServiceInfo => checked(serviceInfoSchema, input, 'invalid_service_info')
export const parseSyncNode = (input: unknown): SyncNode => checked(syncNodeSchema, input, 'invalid_node')
export const parseOperation = (input: unknown) => checked(syncOperationSchema, input, 'invalid_operation')
export const parsePushRequest = (input: unknown): PushRequest => checked(pushRequestSchema, input, 'invalid_push_request')
export const parsePullResponse = (input: unknown): PullResponse => checked(pullResponseSchema, input, 'invalid_pull_response')
export const parseBackupManifest = (input: unknown): BackupManifest => checked(backupManifestSchema, input, 'invalid_backup_manifest')
export const parseBindComplete = (input: unknown): BindCompleteRequest => checked(bindCompleteRequestSchema, input, 'invalid_bind_request')

export { PROTOCOL_MIN_CLIENT_VERSION, PROTOCOL_SERVICE, PROTOCOL_VERSION }
