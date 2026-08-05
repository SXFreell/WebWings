import type pg from 'pg'
import type {
  BindCompleteRequest,
  BindCompleteResponse,
  BindStartRequest,
  BindStartResponse,
  CloudSnapshot,
  SyncNode,
} from '@webwings/sync-protocol'
import type { ServerConfig } from '../config'
import { hashToken, newId, randomToken, sha256Hex } from '../crypto'
import { withTransaction } from '../db'
import { conflict, notFound, unauthorized } from '../errors'
import { validateSrkey } from '../keys'
import { canonicalJson } from '../util'
import { BindSessionRepo } from '../repos/bindSessions'
import { DeviceRepo } from '../repos/devices'
import { EventRepo, ReceiptRepo } from '../repos/events'
import { KeyRepo } from '../repos/keys'
import { NamespaceRepo } from '../repos/namespaces'
import { NodeRepo } from '../repos/nodes'
import { SnapshotRepo } from '../repos/snapshots'
import { SessionService } from '../sessions'
import { assignPositions, validateBatch } from './import'
import { nodeInputFromProtocol, nodeInsertToProtocol, nodeToProtocol, snapshotPayload } from './serialize'
import { SnapshotService } from './snapshots'

export class BindService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: ServerConfig,
    private readonly sessionService: SessionService,
  ) {}

  async start(input: BindStartRequest): Promise<BindStartResponse> {
    const key = await validateSrkey(this.pool, this.config, input.srkey)
    if (!key) throw unauthorized('invalid srkey')
    const bindToken = randomToken()
    const sessionId = newId()
    const expiresAt = new Date(Date.now() + this.config.bindSessionTtlMinutes * 60_000).toISOString()
    const result = await withTransaction(this.pool, async (client) => {
      const namespaces = new NamespaceRepo(client)
      const ns = await namespaces.lock(key.namespaceId)
      if (!ns) throw unauthorized('invalid srkey')
      const nodes = await new NodeRepo(client).getAll(key.namespaceId)
      const active = nodes.filter((node) => !node.deletedAt)
      const retainedTombstones = nodes.filter(
        (node) => node.deletedAt && Date.now() - new Date(node.deletedAt).getTime() <= this.config.deleteRetentionDays * 86_400_000,
      )
      const backupNodes = [...active, ...retainedTombstones].map(nodeToProtocol)
      const digest = sha256Hex(canonicalJson(backupNodes))
      const device = await new DeviceRepo(client).createDevice(key.id, input.deviceName ?? null, input.deviceInfo ?? null)
      await new BindSessionRepo(client).create({
        id: sessionId,
        keyId: key.id,
        deviceId: device.id,
        bindTokenHash: hashToken(bindToken),
        syncEpoch: ns.syncEpoch,
        cloudSeq: ns.currentSeq,
        cloudHasData: active.length > 0,
        cloudDigest: digest,
        cloudSnapshot: backupNodes,
        expiresAt,
      })
      return { ns, hasData: active.length > 0 }
    })
    return {
      v: 1,
      bindSessionId: sessionId,
      bindToken,
      expiresAt,
      keyId: key.id,
      keyPrefix: key.keyPrefix,
      role: key.role,
      capabilities: key.role === 'admin' ? ['sync', 'keys:manage'] : ['sync'],
      cloud: {
        hasData: result.hasData,
        cloudSeq: result.ns.currentSeq,
        syncEpoch: result.ns.syncEpoch,
      },
    }
  }

  private async loadSession(bindToken: string, sessionId: string) {
    const session = await new BindSessionRepo(this.pool).getByTokenHash(hashToken(bindToken))
    if (!session || session.id !== sessionId) throw unauthorized('invalid bind token')
    if (session.state === 'expired' || new Date(session.expiresAt).getTime() <= Date.now()) {
      throw conflict('bind_session_expired', 'bind session has expired; start a new bind')
    }
    const key = await new KeyRepo(this.pool).get(session.keyId)
    if (!key || key.status !== 'active') throw unauthorized('invalid srkey')
    return { session, key }
  }

  async cloudSnapshot(bindToken: string, sessionId: string): Promise<CloudSnapshot> {
    const { session } = await this.loadSession(bindToken, sessionId)
    const nodes = (session.cloudSnapshot as SyncNode[]) ?? []
    return {
      v: 1,
      bindSessionId: session.id,
      cloudSeq: session.cloudSeq,
      syncEpoch: session.syncEpoch,
      digest: session.cloudDigest ?? sha256Hex(canonicalJson(nodes)),
      nodes,
    }
  }

  async backupProof(
    bindToken: string,
    sessionId: string,
    proof: { cloudDigest: string; localDigest: string; localRevision: number; downloadState: 'complete'; downloadedAt: string },
  ): Promise<void> {
    const { session } = await this.loadSession(bindToken, sessionId)
    if (proof.downloadState !== 'complete') throw conflict('backup_not_complete', 'backup download must complete first')
    if (proof.cloudDigest !== session.cloudDigest) {
      throw conflict('backup_mismatch', 'cloud digest does not match the locked bind snapshot')
    }
    if (!/^[0-9a-f]{64}$/.test(proof.localDigest)) throw conflict('backup_invalid', 'invalid local digest')
    await new BindSessionRepo(this.pool).markBackupProven(
      session.id,
      proof.localRevision,
      proof.localDigest,
      proof.cloudDigest,
    )
  }

  async complete(bindToken: string, sessionId: string, request: BindCompleteRequest): Promise<BindCompleteResponse> {
    const { session, key } = await this.loadSession(bindToken, sessionId)
    const bindSessions = new BindSessionRepo(this.pool)

    if (session.state === 'completed') {
      if (session.operationId !== request.operationId) {
        throw conflict('bind_conflict', 'bind session was completed with a different operation')
      }
      return this.idempotentResult(session.id, key.id, session.syncEpoch, session.completedSeq ?? session.cloudSeq)
    }
    if (session.state !== 'backup_proven') throw conflict('backup_required', 'backup proof is required before completing')
    if (
      request.expected.cloudSeq !== session.cloudSeq ||
      request.expected.syncEpoch !== session.syncEpoch ||
      request.expected.localRevision !== (session.localRevision ?? null)
    ) {
      throw conflict('version_changed', 'versions changed since the backups were captured; re-export both sides')
    }

    const localNodes = request.localNodes.map(nodeInputFromProtocol)
    if (!session.cloudHasData && request.strategy !== 'initialize_cloud') {
      throw conflict('invalid_strategy', 'cloud is empty; use initialize_cloud')
    }
    if (session.cloudHasData && request.strategy === 'initialize_cloud') {
      throw conflict('invalid_strategy', 'cloud is not empty; choose use_cloud, use_local or merge')
    }

    const snapshotService = new SnapshotService()
    const result = await withTransaction(this.pool, async (client) => {
      const namespaces = new NamespaceRepo(client)
      const ns = await namespaces.lock(key.namespaceId)
      if (!ns || ns.syncEpoch !== session.syncEpoch || ns.currentSeq !== session.cloudSeq) {
        throw conflict('version_changed', 'cloud versions changed since the backups were captured')
      }
      const nodes = new NodeRepo(client)
      const events = new EventRepo(client)
      const receipts = new ReceiptRepo(client)
      const epoch = ns.syncEpoch

      if (request.strategy === 'use_cloud') {
        const cloudNodes = (session.cloudSnapshot as SyncNode[]) ?? []
        const payload = snapshotPayload(epoch, session.cloudSeq, session.cloudDigest ?? '', cloudNodes)
        await bindSessions.markCompleted(session.id, request.strategy, request.operationId, epoch, session.cloudSeq)
        return { epoch, seq: session.cloudSeq, payload, deviceId: session.deviceId }
      }

      await validateBatch(client, key.namespaceId, localNodes)
      const positioned = await assignPositions(client, key.namespaceId, localNodes)

      if (request.strategy === 'initialize_cloud') {
        const seq = await namespaces.allocateSeq(key.namespaceId)
        for (const node of positioned) await nodes.insert(key.namespaceId, node, 1, seq)
        await namespaces.markInitialized(key.namespaceId)
        await events.append(key.namespaceId, epoch, seq, request.operationId, session.deviceId, 'imported', {
          nodes: positioned.map(nodeInsertToProtocol),
        })
        await receipts.insert(key.namespaceId, request.operationId, seq, 'accepted', null, null)
        const { payload } = await snapshotService.buildAndStore(client, key.namespaceId, epoch, seq)
        await bindSessions.markCompleted(session.id, request.strategy, request.operationId, epoch, seq)
        return { epoch, seq, payload, deviceId: session.deviceId }
      }

      if (request.strategy === 'use_local') {
        await nodes.purgeNamespace(key.namespaceId)
        const newEpoch = await namespaces.bumpEpoch(key.namespaceId)
        const seq = await namespaces.allocateSeq(key.namespaceId)
        for (const node of positioned) await nodes.insert(key.namespaceId, node, 1, seq)
        await events.append(key.namespaceId, newEpoch, seq, request.operationId, session.deviceId, 'epoch_reset', {
          epoch: newEpoch,
          nodes: positioned.map(nodeInsertToProtocol),
        })
        await receipts.insert(key.namespaceId, request.operationId, seq, 'accepted', null, null)
        const { payload } = await snapshotService.buildAndStore(client, key.namespaceId, newEpoch, seq)
        await bindSessions.markCompleted(session.id, request.strategy, request.operationId, newEpoch, seq)
        return { epoch: newEpoch, seq, payload, deviceId: session.deviceId }
      }

      // merge: preserve cloud, remap colliding local ids, append roots
      const existing = await nodes.getAll(key.namespaceId)
      const existingIds = new Set(existing.map((node) => node.id))
      const idMap = new Map<string, string>()
      for (const node of positioned) if (existingIds.has(node.id)) idMap.set(node.id, newId())
      const remapped = positioned.map((node) => ({
        ...node,
        id: idMap.get(node.id) ?? node.id,
        parentId: node.parentId === '' ? '' : idMap.get(node.parentId) ?? node.parentId,
      }))
      await validateBatch(client, key.namespaceId, remapped)
      const merged = await assignPositions(client, key.namespaceId, remapped)
      const seq = await namespaces.allocateSeq(key.namespaceId)
      for (const node of merged) await nodes.insert(key.namespaceId, node, 1, seq)
      await events.append(key.namespaceId, epoch, seq, request.operationId, session.deviceId, 'imported', {
        nodes: merged.map(nodeInsertToProtocol),
      })
      await receipts.insert(key.namespaceId, request.operationId, seq, 'accepted', null, null)
      const { payload } = await snapshotService.buildAndStore(client, key.namespaceId, epoch, seq)
      await bindSessions.markCompleted(session.id, request.strategy, request.operationId, epoch, seq)
      return { epoch, seq, payload, deviceId: session.deviceId }
    })

    const keyRow = await new KeyRepo(this.pool).get(key.id)
    if (!keyRow) throw notFound('key not found')
    const deviceSession = await this.sessionService.issueForDevice(keyRow, result.deviceId)
    return {
      v: 1,
      deviceSession,
      snapshot: result.payload as BindCompleteResponse['snapshot'],
    }
  }

  private async idempotentResult(sessionId: string, keyId: string, epoch: number, seq: number): Promise<BindCompleteResponse> {
    const keyRow = await new KeyRepo(this.pool).get(keyId)
    const bindSessions = new BindSessionRepo(this.pool)
    const session = await bindSessions.get(sessionId)
    if (!keyRow || !session) throw notFound('bind session not found')
    let payload: BindCompleteResponse['snapshot']
    const snapshot = await new SnapshotRepo(this.pool).latestAtOrBefore(keyRow.namespaceId, seq)
    if (snapshot) {
      payload = snapshot.payload as BindCompleteResponse['snapshot']
    } else {
      const nodes = (session.cloudSnapshot as SyncNode[]) ?? []
      payload = snapshotPayload(epoch, seq, session.cloudDigest ?? '', nodes)
    }
    const deviceSession = await this.sessionService.issueForDevice(keyRow, session.deviceId)
    return { v: 1, deviceSession, snapshot: payload }
  }
}
