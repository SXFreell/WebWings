import type { SyncNode, SyncNodeCreateInput } from '@webwings/sync-protocol'
import type { NodeInsert } from '../repos/nodes'
import type { NodeRow } from '../repos/types'

export const nodeToProtocol = (row: NodeRow): SyncNode => ({
  id: row.id,
  type: row.type,
  parentId: row.parentId === '' ? null : row.parentId,
  title: row.title,
  ...(row.url ? { url: row.url } : {}),
  ...(row.favicon ? { favicon: row.favicon } : {}),
  positionKey: row.positionKey,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  version: row.version,
  deletedAt: row.deletedAt,
  recoveryReason: row.recoveryReason,
})

export const nodeInputFromProtocol = (input: SyncNodeCreateInput): NodeInsert => ({
  id: input.id,
  type: input.type,
  parentId: input.parentId === null ? '' : input.parentId,
  title: input.title,
  url: input.url ?? null,
  favicon: input.favicon ?? null,
  positionKey: input.positionKey ?? '',
  createdAt: input.createdAt,
  updatedAt: input.updatedAt,
})

/** Converts an unpersisted NodeInsert to the protocol shape (fresh node). */
export const nodeInsertToProtocol = (node: NodeInsert): SyncNode => ({
  id: node.id,
  type: node.type,
  parentId: node.parentId === '' ? null : node.parentId,
  title: node.title,
  ...(node.url ? { url: node.url } : {}),
  ...(node.favicon ? { favicon: node.favicon } : {}),
  positionKey: node.positionKey,
  createdAt: node.createdAt,
  updatedAt: node.updatedAt,
  version: 1,
  deletedAt: null,
  recoveryReason: null,
})

export const snapshotPayload = (epoch: number, seq: number, digest: string, nodes: SyncNode[]) => ({
  v: 1 as const,
  epoch,
  seq,
  digest,
  nodes,
})
