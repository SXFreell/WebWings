export type NodeType = 'folder' | 'bookmark'

export interface BaseNode {
  id: string
  type: NodeType
  parentId: string | null
  title: string
  order: number
  createdAt: string
  updatedAt: string
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
