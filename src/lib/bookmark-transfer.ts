import type { ExportPayload, FavoriteNode } from '../types'

const payload = (nodes: FavoriteNode[], exportedAt: string): ExportPayload => ({
  format: 'webwings-bookmarks',
  version: 1,
  exportedAt,
  nodes,
})

export const createFullExport = (nodes: FavoriteNode[], exportedAt = new Date().toISOString()): ExportPayload => (
  payload(nodes.map((node) => ({ ...node })), exportedAt)
)

export const createFolderExport = (
  nodes: FavoriteNode[],
  folderId: string,
  exportedAt = new Date().toISOString(),
): ExportPayload => {
  const source = nodes.find((node) => node.id === folderId)
  if (!source) throw new Error('导出目录不存在')
  if (source.type !== 'folder') throw new Error('导出目标不是目录')

  const includedParents = new Set<string>([folderId])
  const includedIds = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (node.parentId && includedParents.has(node.parentId) && !includedIds.has(node.id)) {
        includedIds.add(node.id)
        if (node.type === 'folder') includedParents.add(node.id)
        changed = true
      }
    }
  }

  return payload(
    nodes
      .filter((node) => includedIds.has(node.id))
      .map((node) => ({ ...node, parentId: node.parentId === folderId ? null : node.parentId })),
    exportedAt,
  )
}

export const remapImportedNodes = (
  imported: FavoriteNode[],
  existing: FavoriteNode[],
  targetParentId: string | null,
  createId: () => string,
): FavoriteNode[] => {
  if (targetParentId) {
    const target = existing.find((node) => node.id === targetParentId)
    if (!target) throw new Error('导入目标目录不存在')
    if (target.type !== 'folder') throw new Error('导入目标不是目录')
  }

  const reservedIds = new Set(existing.map((node) => node.id))
  const sourceIds = new Set(imported.map((node) => node.id))
  const idMap = new Map<string, string>()
  for (const node of imported) {
    const newId = createId()
    if (!newId || reservedIds.has(newId) || sourceIds.has(newId)) throw new Error('生成的收藏项目 ID 重复')
    reservedIds.add(newId)
    idMap.set(node.id, newId)
  }

  const targetSiblings = existing.filter((node) => node.parentId === targetParentId)
  const firstRootOrder = targetSiblings.length
    ? Math.max(...targetSiblings.map((node) => node.order)) + 1
    : 0
  const rootOrders = new Map(
    imported
      .filter((node) => node.parentId === null)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((node, index) => [node.id, firstRootOrder + index]),
  )

  return imported.map((node) => ({
    ...node,
    id: idMap.get(node.id)!,
    parentId: node.parentId === null ? targetParentId : idMap.get(node.parentId)!,
    order: node.parentId === null ? rootOrders.get(node.id)! : node.order,
  }))
}
