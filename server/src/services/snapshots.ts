import type { SyncNode } from '@webwings/sync-protocol'
import type { Queryable } from '../db'
import { sha256Hex } from '../crypto'
import { canonicalJson } from '../util'
import { NodeRepo } from '../repos/nodes'
import { SnapshotRepo } from '../repos/snapshots'
import { nodeToProtocol, snapshotPayload } from './serialize'

export class SnapshotService {
  /** Computes the canonical digest over the namespace's active nodes. */
  async digestFor(client: Queryable, namespaceId: string): Promise<{ digest: string; nodes: SyncNode[] }> {
    const nodes = (await new NodeRepo(client).getActiveNodes(namespaceId)).map(nodeToProtocol)
    return { digest: sha256Hex(canonicalJson(nodes)), nodes }
  }

  /** Builds and persists a snapshot at the given (epoch, seq). */
  async buildAndStore(
    client: Queryable,
    namespaceId: string,
    epoch: number,
    seq: number,
  ): Promise<{ digest: string; payload: unknown }> {
    const { digest, nodes } = await this.digestFor(client, namespaceId)
    const payload = snapshotPayload(epoch, seq, digest, nodes)
    await new SnapshotRepo(client).insert(namespaceId, epoch, seq, digest, payload)
    return { digest, payload }
  }
}
