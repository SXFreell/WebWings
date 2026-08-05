import type pg from 'pg'
import type { OperationReceipt, SyncNodeCreateInput, SyncOperation } from '@webwings/sync-protocol'
import type { AuthContext } from '../sessions'
import { newId, sha256Hex } from '../crypto'
import { withTransaction, type DbClient } from '../db'
import { ApiError, conflict, invalidRequest } from '../errors'
import { nextPosition } from '../positions'
import { EventRepo, ReceiptRepo } from '../repos/events'
import { NamespaceRepo } from '../repos/namespaces'
import { NodeRepo, type NodeInsert, type NodePatchFields } from '../repos/nodes'
import { canonicalJson } from '../util'
import { assignPositions, normalizePosition, validateBatch } from './import'
import { nodeInputFromProtocol, nodeInsertToProtocol, nodeToProtocol } from './serialize'

export type EventNotifier = (namespaceId: string, epoch: number, seq: number) => void

const isApiError = (error: unknown): error is ApiError => error instanceof ApiError

export class OperationService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly maxNodesPerImport: number,
    private readonly notify?: EventNotifier,
  ) {}

  async push(ctx: AuthContext, ops: SyncOperation[]): Promise<OperationReceipt[]> {
    if (ops.length > 200) throw invalidRequest('too many operations in one push')
    return withTransaction(this.pool, async (client) => {
      const namespaces = new NamespaceRepo(client)
      const ns = await namespaces.lock(ctx.namespaceId)
      if (!ns) throw new ApiError(404, 'not_found', 'namespace not found')
      const receipts = new ReceiptRepo(client)
      const result: OperationReceipt[] = []
      for (const op of ops) {
        const existing = await receipts.get(ctx.namespaceId, op.opId)
        if (existing) {
          result.push({
            opId: op.opId,
            status: existing.status,
            seq: existing.seq === null ? null : existing.seq,
            ...(existing.errorCode ? { errorCode: existing.errorCode } : {}),
            ...(existing.payload && typeof existing.payload === 'object' && 'errorMessage' in (existing.payload as object)
              ? { errorMessage: (existing.payload as { errorMessage: string }).errorMessage }
              : {}),
          })
          continue
        }
        if (op.syncEpoch !== ns.syncEpoch) {
          await receipts.insert(ctx.namespaceId, op.opId, null, 'epoch_mismatch', 'epoch_mismatch', {
            errorMessage: 'operation epoch is stale; install the current snapshot',
          })
          result.push({
            opId: op.opId,
            status: 'epoch_mismatch',
            seq: null,
            errorCode: 'epoch_mismatch',
            errorMessage: 'operation epoch is stale; install the current snapshot',
          })
          continue
        }
        try {
          const seq = await this.applyOperation(client, ctx, op)
          await receipts.insert(ctx.namespaceId, op.opId, seq, 'accepted', null, null)
          result.push({ opId: op.opId, status: 'accepted', seq })
          this.notify?.(ctx.namespaceId, ns.syncEpoch, seq)
        } catch (error) {
          if (isApiError(error)) {
            await receipts.insert(ctx.namespaceId, op.opId, null, 'rejected', error.code, {
              errorMessage: error.message,
            })
            result.push({
              opId: op.opId,
              status: 'rejected',
              seq: null,
              errorCode: error.code,
              errorMessage: error.message,
            })
          } else {
            throw error
          }
        }
      }
      return result
    })
  }

  private async allocate(client: DbClient, namespaceId: string) {
    return new NamespaceRepo(client).allocateSeq(namespaceId)
  }

  private async applyOperation(client: DbClient, ctx: AuthContext, op: SyncOperation): Promise<number> {
    const nodes = new NodeRepo(client)
    const events = new EventRepo(client)
    switch (op.type) {
      case 'create_node': {
        const input = nodeInputFromProtocol(op.node)
        assertCreateShape(input)
        const existing = await nodes.get(ctx.namespaceId, input.id)
        if (existing) throw conflict('duplicate_node', `node ${input.id} already exists`)
        let parentId = input.parentId
        let recoveryReason: string | null = null
        if (parentId !== '') {
          const parent = await nodes.get(ctx.namespaceId, parentId)
          if (!parent) throw conflict('parent_not_found', `parent ${parentId} does not exist`)
          if (parent.type !== 'folder') throw conflict('invalid_parent', `parent ${parentId} is not a folder`)
          if (parent.deletedAt) {
            parentId = ''
            recoveryReason = 'parent_deleted'
          }
        }
        const positionKey = await this.freePosition(client, ctx.namespaceId, parentId, input.positionKey)
        const seq = await this.allocate(client, ctx.namespaceId)
        const row = await nodes.insert(
          ctx.namespaceId,
          { ...input, parentId, positionKey },
          1,
          seq,
          recoveryReason,
        )
        await events.append(ctx.namespaceId, op.syncEpoch, seq, op.opId, ctx.deviceId, 'created', {
          node: nodeToProtocol(row),
        })
        return seq
      }
      case 'patch_node': {
        const node = await nodes.get(ctx.namespaceId, op.nodeId)
        if (!node) throw conflict('node_not_found', `node ${op.nodeId} does not exist`)
        if (node.deletedAt) throw conflict('node_deleted', `node ${op.nodeId} is deleted and cannot be patched`)
        if (op.baseVersion > node.version) throw conflict('version_conflict', 'patch is based on a newer version')
        const patch: NodePatchFields = {}
        if (op.patch.title !== undefined) {
          if (!op.patch.title.trim()) throw invalidRequest('title cannot be empty')
          patch.title = op.patch.title
        }
        if (op.patch.url !== undefined) {
          if (node.type === 'folder' && op.patch.url) throw invalidRequest('folder cannot have a url')
          patch.url = op.patch.url
        }
        if (op.patch.favicon !== undefined) patch.favicon = op.patch.favicon
        const seq = await this.allocate(client, ctx.namespaceId)
        const updated = await nodes.patch(ctx.namespaceId, op.nodeId, patch, node.version + 1, seq)
        if (!updated) throw conflict('node_deleted', `node ${op.nodeId} is deleted and cannot be patched`)
        await events.append(ctx.namespaceId, op.syncEpoch, seq, op.opId, ctx.deviceId, 'patched', {
          nodeId: op.nodeId,
          patch: op.patch,
          version: updated.version,
        })
        return seq
      }
      case 'move_node': {
        const node = await nodes.getActive(ctx.namespaceId, op.nodeId)
        if (!node) throw conflict('node_not_found', `node ${op.nodeId} does not exist`)
        const newParentId = op.newParentId === null ? '' : op.newParentId
        if (newParentId === op.nodeId) throw conflict('invalid_move', 'cannot move a node into itself')
        if (newParentId !== '') {
          const parent = await nodes.getActive(ctx.namespaceId, newParentId)
          if (!parent || parent.type !== 'folder') throw conflict('invalid_parent', 'target parent is not an active folder')
          if (await this.isDescendant(client, ctx.namespaceId, op.nodeId, newParentId)) {
            throw conflict('cycle', 'cannot move a directory into its own descendant')
          }
        }
        const positionKey = await this.freePosition(client, ctx.namespaceId, newParentId, null)
        const seq = await this.allocate(client, ctx.namespaceId)
        const updated = await nodes.move(ctx.namespaceId, op.nodeId, newParentId, positionKey, node.version + 1, seq)
        if (!updated) throw conflict('node_not_found', `node ${op.nodeId} does not exist`)
        await events.append(ctx.namespaceId, op.syncEpoch, seq, op.opId, ctx.deviceId, 'moved', {
          nodeId: op.nodeId,
          newParentId: newParentId === '' ? null : newParentId,
          positionKey,
          version: updated.version,
        })
        return seq
      }
      case 'delete_tree': {
        const node = await nodes.getActive(ctx.namespaceId, op.nodeId)
        if (!node) throw conflict('node_not_found', `node ${op.nodeId} does not exist`)
        const seq = await this.allocate(client, ctx.namespaceId)
        const batchId = newId()
        const ids = await nodes.softDeleteTree(ctx.namespaceId, op.nodeId, batchId)
        await events.append(ctx.namespaceId, op.syncEpoch, seq, op.opId, ctx.deviceId, 'deleted', {
          nodeId: op.nodeId,
          batchId,
          ids,
        })
        return seq
      }
      case 'restore_node': {
        const node = await nodes.get(ctx.namespaceId, op.nodeId)
        if (!node || !node.deletedAt) throw conflict('node_not_found', `node ${op.nodeId} is not deleted`)
        const seq = await this.allocate(client, ctx.namespaceId)
        const ids = await nodes.restore(ctx.namespaceId, op.nodeId)
        await events.append(ctx.namespaceId, op.syncEpoch, seq, op.opId, ctx.deviceId, 'restored', {
          nodeId: op.nodeId,
          ids,
        })
        return seq
      }
      case 'import_nodes': {
        if (op.nodes.length > this.maxNodesPerImport) {
          throw invalidRequest(`import exceeds the limit of ${this.maxNodesPerImport} nodes`)
        }
        return this.importBatch(client, ctx, op.nodes, op.opId, op.syncEpoch, ctx.deviceId)
      }
      default:
        throw invalidRequest('unsupported operation type')
    }
  }

  private async importBatch(
    client: DbClient,
    ctx: AuthContext,
    inputs: SyncNodeCreateInput[],
    opId: string,
    epoch: number,
    deviceId: string,
  ): Promise<number> {
    const nodes = new NodeRepo(client)
    const events = new EventRepo(client)
    let batch = inputs.map(nodeInputFromProtocol)
    for (const node of batch) assertCreateShape(node)
    await validateBatch(client, ctx.namespaceId, batch)
    const existing = await nodes.getAll(ctx.namespaceId)
    const existingIds = new Set(existing.map((node) => node.id))
    const idMap = new Map<string, string>()
    for (const node of batch) if (existingIds.has(node.id)) idMap.set(node.id, newId())
    if (idMap.size > 0) {
      batch = batch.map((node) => ({
        ...node,
        id: idMap.get(node.id) ?? node.id,
        parentId: node.parentId === '' ? '' : idMap.get(node.parentId) ?? node.parentId,
      }))
      await validateBatch(client, ctx.namespaceId, batch)
    }
    const positioned = await assignPositions(client, ctx.namespaceId, batch)
    const seq = await this.allocate(client, ctx.namespaceId)
    for (const node of positioned) await nodes.insert(ctx.namespaceId, node, 1, seq)
    await events.append(ctx.namespaceId, epoch, seq, opId, deviceId, 'imported', {
      nodes: positioned.map(nodeInsertToProtocol),
    })
    return seq
  }

  private async freePosition(
    client: DbClient,
    namespaceId: string,
    parentId: string,
    requested: string | null,
  ): Promise<string> {
    const nodes = new NodeRepo(client)
    const siblings = await nodes.getChildren(namespaceId, parentId)
    const keys = siblings.map((sibling) => sibling.positionKey)
    const normalized = requested ? normalizePosition(requested) : null
    if (normalized && !keys.includes(normalized)) return normalized
    return keys.length ? nextPosition(keys) : nextPosition([])
  }

  private async isDescendant(client: DbClient, namespaceId: string, rootId: string, candidate: string): Promise<boolean> {
    const nodes = new NodeRepo(client)
    const stack = [rootId]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      const children = await nodes.getActiveChildren(namespaceId, id)
      for (const child of children) stack.push(child.id)
    }
    return seen.has(candidate)
  }
}

const assertCreateShape = (node: NodeInsert): void => {
  if (node.type === 'bookmark' && !node.url) throw invalidRequest(`bookmark ${node.id} requires a url`)
  if (node.type === 'folder' && node.url) throw invalidRequest(`folder ${node.id} must not have a url`)
  if (!node.title) throw invalidRequest(`node ${node.id} requires a title`)
}

/** Digest helper used by sync endpoints for snapshot verification. */
export const nodesDigest = (nodes: unknown[]): string => sha256Hex(canonicalJson(nodes))
