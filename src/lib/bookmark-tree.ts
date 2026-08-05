import type { FavoriteNode, FolderNode } from '@/types'

export const sortNodes = <T extends FavoriteNode>(nodes: T[]) => (
  [...nodes].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'))
)

export const getDescendantFolderIds = (folders: FolderNode[], folderId: string) => {
  const ids = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if ((folder.parentId === folderId || (folder.parentId && ids.has(folder.parentId))) && !ids.has(folder.id)) {
        ids.add(folder.id)
        changed = true
      }
    }
  }
  return ids
}

export const folderPath = (folders: FolderNode[], id: string | null) => {
  if (!id) return []
  const map = new Map(folders.map((folder) => [folder.id, folder]))
  const path: FolderNode[] = []
  const visited = new Set<string>()
  let current = map.get(id)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    path.unshift(current)
    current = current.parentId ? map.get(current.parentId) : undefined
  }
  return path
}

export const availableFolders = (folders: FolderNode[], excludedIds = new Set<string>()) => (
  folders.filter((folder) => !excludedIds.has(folder.id))
)

export const folderCascaderColumns = (folders: FolderNode[], expandedPathIds: string[]) => {
  const columns: FolderNode[][] = [sortNodes(folders.filter((folder) => folder.parentId === null))]
  const visited = new Set<string>()
  for (const id of expandedPathIds) {
    if (visited.has(id)) break
    visited.add(id)
    const children = sortNodes(folders.filter((folder) => folder.parentId === id))
    if (!children.length) break
    columns.push(children)
  }
  return columns
}

export const folderDisplayPath = (folders: FolderNode[], id: string | null, rootLabel: string) => {
  if (!id) return rootLabel
  const path = folderPath(folders, id)
  return path.length ? path.map((folder) => folder.title).join(' / ') : rootLabel
}

export const flattenFolders = (folders: FolderNode[], excluded = new Set<string>()) => {
  const output: Array<{ folder: FolderNode; depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    sortNodes(folders.filter((folder) => folder.parentId === parentId)).forEach((folder) => {
      if (excluded.has(folder.id)) return
      output.push({ folder, depth })
      walk(folder.id, depth + 1)
    })
  }
  walk(null, 0)
  return output
}
