import type { Queryable } from '../db'
import type { NodeRow } from './types'

const COLUMNS = `namespace_id as "namespaceId", id, type, parent_id as "parentId", title, url, favicon,
  position_key as "positionKey", version, field_versions as "fieldVersions",
  created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt",
  delete_batch_id as "deleteBatchId", recovery_reason as "recoveryReason"`

export interface NodeInsert {
  id: string
  type: 'folder' | 'bookmark'
  parentId: string
  title: string
  url?: string | null
  favicon?: string | null
  positionKey: string
  createdAt: string
  updatedAt: string
}

export interface NodePatchFields {
  title?: string
  url?: string | null
  favicon?: string | null
}

export class NodeRepo {
  constructor(private readonly db: Queryable) {}

  async get(namespaceId: string, id: string): Promise<NodeRow | null> {
    const result = await this.db.query<NodeRow>(
      `select ${COLUMNS} from bookmark_nodes where namespace_id = $1 and id = $2`,
      [namespaceId, id],
    )
    return result.rows[0] ?? null
  }

  async getActive(namespaceId: string, id: string): Promise<NodeRow | null> {
    const result = await this.db.query<NodeRow>(
      `select ${COLUMNS} from bookmark_nodes where namespace_id = $1 and id = $2 and deleted_at is null`,
      [namespaceId, id],
    )
    return result.rows[0] ?? null
  }

  async getActiveChildren(namespaceId: string, parentId: string): Promise<NodeRow[]> {
    const result = await this.db.query<NodeRow>(
      `select ${COLUMNS} from bookmark_nodes
       where namespace_id = $1 and parent_id = $2 and deleted_at is null
       order by position_key, id`,
      [namespaceId, parentId],
    )
    return result.rows
  }

  /** Children including tombstones; position allocation must avoid deleted rows. */
  async getChildren(namespaceId: string, parentId: string): Promise<NodeRow[]> {
    const result = await this.db.query<NodeRow>(
      `select ${COLUMNS} from bookmark_nodes
       where namespace_id = $1 and parent_id = $2
       order by position_key, id`,
      [namespaceId, parentId],
    )
    return result.rows
  }

  /** All nodes including tombstones; used for backups and snapshots. */
  async getAll(namespaceId: string): Promise<NodeRow[]> {
    const result = await this.db.query<NodeRow>(
      `select ${COLUMNS} from bookmark_nodes where namespace_id = $1 order by parent_id, position_key, id`,
      [namespaceId],
    )
    return result.rows
  }

  async getActiveNodes(namespaceId: string): Promise<NodeRow[]> {
    const result = await this.db.query<NodeRow>(
      `select ${COLUMNS} from bookmark_nodes
       where namespace_id = $1 and deleted_at is null
       order by parent_id, position_key, id`,
      [namespaceId],
    )
    return result.rows
  }

  async countActive(namespaceId: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      'select count(*)::text as count from bookmark_nodes where namespace_id = $1 and deleted_at is null',
      [namespaceId],
    )
    return Number(result.rows[0].count)
  }

  async insert(
    namespaceId: string,
    node: NodeInsert,
    version: number,
    seq: number,
    recoveryReason: string | null = null,
  ): Promise<NodeRow> {
    const fieldVersions: Record<string, number> = { title: seq }
    if (node.url !== undefined && node.url !== null) fieldVersions.url = seq
    if (node.favicon !== undefined && node.favicon !== null) fieldVersions.favicon = seq
    const result = await this.db.query<NodeRow>(
      `insert into bookmark_nodes
        (namespace_id, id, type, parent_id, title, url, favicon, position_key,
         version, field_versions, created_at, updated_at, recovery_reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning ${COLUMNS}`,
      [
        namespaceId,
        node.id,
        node.type,
        node.parentId,
        node.title,
        node.url ?? null,
        node.favicon ?? null,
        node.positionKey,
        version,
        JSON.stringify(fieldVersions),
        node.createdAt,
        node.updatedAt,
        recoveryReason,
      ],
    )
    return result.rows[0]
  }

  /** Field-level patch; same-field writes are resolved by the caller's seq ordering. */
  async patch(
    namespaceId: string,
    id: string,
    fields: NodePatchFields,
    version: number,
    seq: number,
  ): Promise<NodeRow | null> {
    const existing = await this.get(namespaceId, id)
    if (!existing || existing.deletedAt) return null
    const fieldVersions = { ...existing.fieldVersions }
    const sets: string[] = ['updated_at = now()', 'version = $3']
    const params: unknown[] = [namespaceId, id, version]
    for (const [key, value] of Object.entries(fields)) {
      params.push(value ?? null)
      sets.push(`${key} = $${params.length}`)
      fieldVersions[key] = seq
    }
    params.push(JSON.stringify(fieldVersions))
    sets.push(`field_versions = $${params.length}::jsonb`)
    const result = await this.db.query<NodeRow>(
      `update bookmark_nodes set ${sets.join(', ')}
       where namespace_id = $1 and id = $2 and deleted_at is null
       returning ${COLUMNS}`,
      params,
    )
    return result.rows[0] ?? null
  }

  async move(
    namespaceId: string,
    id: string,
    newParentId: string,
    positionKey: string,
    version: number,
    seq: number,
  ): Promise<NodeRow | null> {
    const result = await this.db.query<NodeRow>(
      `update bookmark_nodes
       set parent_id = $3, position_key = $4, updated_at = now(), version = $5
       where namespace_id = $1 and id = $2 and deleted_at is null
       returning ${COLUMNS}`,
      [namespaceId, id, newParentId, positionKey, version],
    )
    return result.rows[0] ?? null
  }

  /** Soft-deletes a directory tree inside the enclosing transaction. */
  async softDeleteTree(namespaceId: string, rootId: string, batchId: string): Promise<string[]> {
    const deleted: string[] = []
    const stack = [rootId]
    while (stack.length > 0) {
      const id = stack.pop()!
      const result = await this.db.query<{ id: string }>(
        `update bookmark_nodes
         set deleted_at = now(), delete_batch_id = $3, updated_at = now(), version = version + 1
         where namespace_id = $1 and id = $2 and deleted_at is null
         returning id`,
        [namespaceId, id, batchId],
      )
      if (result.rows.length === 0) continue
      deleted.push(id)
      const children = await this.db.query<{ id: string }>(
        'select id from bookmark_nodes where namespace_id = $1 and parent_id = $2 and deleted_at is null',
        [namespaceId, id],
      )
      for (const child of children.rows) stack.push(child.id)
    }
    return deleted
  }

  /**
   * Restores a tombstone. A folder also restores descendants deleted in the same batch,
   * so the user sees the whole tree come back. Bookmark restores only the node itself.
   */
  async restore(namespaceId: string, id: string): Promise<string[]> {
    const node = await this.get(namespaceId, id)
    if (!node || !node.deletedAt) return []
    const batch = node.deleteBatchId
    const ids: string[] = [id]
    if (node.type === 'folder' && batch) {
      const stack = [id]
      while (stack.length > 0) {
        const parent = stack.pop()!
        const kids = await this.db.query<{ id: string }>(
          `select id from bookmark_nodes
           where namespace_id = $1 and parent_id = $2 and delete_batch_id = $3`,
          [namespaceId, parent, batch],
        )
        for (const kid of kids.rows) {
          ids.push(kid.id)
          stack.push(kid.id)
        }
      }
    }
    if (ids.length === 1) {
      await this.db.query(
        `update bookmark_nodes
         set deleted_at = null, delete_batch_id = null, recovery_reason = null,
             updated_at = now(), version = version + 1
         where namespace_id = $1 and id = $2`,
        [namespaceId, id],
      )
    } else {
      await this.db.query(
        `update bookmark_nodes
         set deleted_at = null, delete_batch_id = null, recovery_reason = null,
             updated_at = now(), version = version + 1
         where namespace_id = $1 and id = any($2::text[])`,
        [namespaceId, ids],
      )
    }
    return ids
  }

  async updatePositions(namespaceId: string, positions: Array<{ id: string; positionKey: string }>): Promise<void> {
    for (const entry of positions) {
      await this.db.query(
        `update bookmark_nodes set position_key = $3, updated_at = now()
         where namespace_id = $1 and id = $2`,
        [namespaceId, entry.id, entry.positionKey],
      )
    }
  }

  async purgeNamespace(namespaceId: string): Promise<void> {
    await this.db.query('delete from bookmark_nodes where namespace_id = $1', [namespaceId])
  }
}
