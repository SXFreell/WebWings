import type { BookmarkNode, ExportPayload, FavoriteNode, FolderNode } from '../types'
import { createFolderExport, createFullExport, remapImportedNodes } from './bookmark-transfer'
import { STORE } from './sync/idb'
import { getAll } from './sync/idb'
import {
  localCreateNode,
  localDeleteTree,
  localImportNodes,
  localMoveNode,
  localPatchNode,
} from './sync/local-ops'

const makeId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
const now = () => new Date().toISOString()

const isActive = (node: FavoriteNode) => !node.deletedAt

export const getAllNodes = async (): Promise<FavoriteNode[]> => {
  const nodes = await getAll<FavoriteNode>(STORE.nodes)
  return nodes.filter(isActive)
}

export const createFolder = async (title: string, parentId: string | null): Promise<FolderNode> => {
  const timestamp = now()
  const { node } = await localCreateNode({
    id: makeId(),
    type: 'folder',
    parentId,
    title: title.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  return node as FolderNode
}

export const createBookmark = async (
  values: Pick<BookmarkNode, 'title' | 'url' | 'favicon'> & { parentId: string | null },
): Promise<BookmarkNode> => {
  const timestamp = now()
  const { node } = await localCreateNode({
    id: makeId(),
    type: 'bookmark',
    parentId: values.parentId,
    title: values.title.trim(),
    url: values.url.trim(),
    ...(values.favicon ? { favicon: values.favicon } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  return node as BookmarkNode
}

/** Saves edits; produces a patch outbox entry when the node is synced. */
export const putNode = async (node: FavoriteNode): Promise<void> => {
  const existing = (await getAllNodes()).find((candidate) => candidate.id === node.id)
  if (!existing) {
    await localCreateNode({
      id: node.id,
      type: node.type,
      parentId: node.parentId,
      title: node.title,
      ...(node.type === 'bookmark' ? { url: node.url, ...(node.favicon ? { favicon: node.favicon } : {}) } : {}),
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    })
    return
  }
  if (existing.parentId !== node.parentId) {
    await localMoveNode(node.id, node.parentId)
  }
  const patch: Record<string, string> = {}
  if (node.title !== existing.title) patch.title = node.title.trim()
  if (node.type === 'bookmark' && existing.type === 'bookmark' && node.url !== existing.url) patch.url = node.url.trim()
  if (node.favicon !== existing.favicon) patch.favicon = node.favicon ?? ''
  if (Object.keys(patch).length > 0) {
    await localPatchNode(node.id, patch, existing.syncVersion ?? 1)
  }
}

export const deleteNodeTree = async (id: string): Promise<void> => {
  await localDeleteTree(id)
}

export const exportBookmarks = async (): Promise<ExportPayload> => {
  const nodes = (await getAllNodes()).filter(isActive)
  return createFullExport(nodes)
}

export const exportFolderBookmarks = async (folderId: string): Promise<ExportPayload> => {
  const nodes = (await getAllNodes()).filter(isActive)
  return createFolderExport(nodes, folderId)
}

const isValidIsoDate = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value))

export const validateImport = (input: unknown): FavoriteNode[] => {
  if (!input || typeof input !== 'object') throw new Error('JSON 文件内容无效')
  const payload = input as Partial<ExportPayload>
  if (payload.format !== 'webwings-bookmarks' || payload.version !== 1 || !Array.isArray(payload.nodes)) {
    throw new Error('不是有效的 WebWings 收藏夹文件')
  }

  const ids = new Set<string>()
  for (const raw of payload.nodes) {
    if (!raw || typeof raw !== 'object') throw new Error('收藏数据中存在无效项目')
    const node = raw as FavoriteNode
    if (typeof node.id !== 'string' || !node.id || ids.has(node.id)) throw new Error('收藏项目 ID 无效或重复')
    if (node.type !== 'folder' && node.type !== 'bookmark') throw new Error('收藏项目类型无效')
    if (node.parentId !== null && typeof node.parentId !== 'string') throw new Error('目录关联无效')
    if (typeof node.title !== 'string' || !node.title.trim()) throw new Error('收藏项目名称不能为空')
    if (!Number.isFinite(node.order) || !isValidIsoDate(node.createdAt) || !isValidIsoDate(node.updatedAt)) {
      throw new Error('收藏项目元数据无效')
    }
    if (node.type === 'bookmark') {
      if (typeof node.url !== 'string') throw new Error('收藏链接无效')
      try {
        const url = new URL(node.url)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
      } catch {
        throw new Error(`链接格式无效：${node.title}`)
      }
    }
    ids.add(node.id)
  }

  const byId = new Map(payload.nodes.map((node) => [node.id, node]))
  for (const node of payload.nodes) {
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId)
      if (!parent || parent.type !== 'folder') throw new Error(`“${node.title}”的上级目录无效`)
    }
    const visited = new Set<string>([node.id])
    let parentId = node.parentId
    while (parentId) {
      if (visited.has(parentId)) throw new Error('目录结构中存在循环嵌套')
      visited.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }
  return payload.nodes
}

export const addNodesAtomically = async (nodes: FavoriteNode[]): Promise<void> => {
  await localImportNodes(
    nodes.map((node) => ({
      id: node.id,
      type: node.type,
      parentId: node.parentId,
      title: node.title,
      ...(node.type === 'bookmark' ? { url: node.url, ...(node.favicon ? { favicon: node.favicon } : {}) } : {}),
      positionKey: node.positionKey,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    })),
  )
}

export const mergeImport = async (
  input: unknown,
  targetParentId: string | null,
  createId: () => string = makeId,
): Promise<FavoriteNode[]> => {
  const validated = validateImport(input)
  const existing = await getAllNodes()
  const imported = remapImportedNodes(validated, existing, targetParentId, createId)
  await addNodesAtomically(imported)
  return imported
}
