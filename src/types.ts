export type NodeType = 'folder' | 'bookmark'

export interface BaseNode {
  id: string
  type: NodeType
  parentId: string | null
  title: string
  order: number
  createdAt: string
  updatedAt: string
  /** Server position key; present after the IndexedDB v2 migration. */
  positionKey?: string
  /** Server-confirmed version; used as patch base for outbox operations. */
  syncVersion?: number
  /** Soft-delete tombstone used by cloud sync. */
  deletedAt?: string | null
  deleteBatchId?: string | null
  recoveryReason?: string | null
}

export interface FolderNode extends BaseNode {
  type: 'folder'
}

export interface BookmarkNode extends BaseNode {
  type: 'bookmark'
  url: string
  favicon?: string
}

export type FavoriteNode = FolderNode | BookmarkNode

export interface ExportPayload {
  format: 'webwings-bookmarks'
  version: 1
  exportedAt: string
  nodes: FavoriteNode[]
}
