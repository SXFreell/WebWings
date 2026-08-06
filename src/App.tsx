import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bookmark, FolderPlus, Settings } from 'lucide-react'
import { BookmarkDialog } from '@/components/bookmarks/BookmarkDialog'
import { BookmarksView } from '@/components/bookmarks/BookmarksView'
import { FolderDialog } from '@/components/bookmarks/FolderDialog'
import { FolderTree } from '@/components/bookmarks/FolderTree'
import { ImportDialog } from '@/components/bookmarks/ImportDialog'
import { Button } from '@/components/ui/button'
import { ALL_BOOKMARKS, type FolderSelection } from '@/features/bookmarks/constants'
import { getCurrentPage, openSettingsPage, type CurrentPage } from '@/lib/browser'
import {
  createBookmark,
  createFolder,
  deleteNodeTree,
  exportFolderBookmarks,
  getAllNodes,
  mergeImport,
  putNode,
} from '@/lib/bookmarks-db'
import { getDescendantFolderIds } from '@/lib/bookmark-tree'
import { onLocalChange } from '@/lib/sync/notify'
import type { BookmarkNode, ExportPayload, FavoriteNode, FolderNode } from '@/types'

const downloadPayload = (payload: ExportPayload, filename: string) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

const safeFilename = (value: string) => value.replace(/[\\/:*?"<>|]/g, '-').trim() || 'folder'
const dateSuffix = () => new Date().toISOString().slice(0, 10)

function App() {
  const [nodes, setNodes] = useState<FavoriteNode[]>([])
  const [selected, setSelected] = useState<FolderSelection>(ALL_BOOKMARKS)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [bookmarkModal, setBookmarkModal] = useState<{ open: boolean; initial: BookmarkNode | CurrentPage | null }>({ open: false, initial: null })
  const [folderModal, setFolderModal] = useState<{ open: boolean; initial: FolderNode | null; parentId: string | null }>({ open: false, initial: null, parentId: null })
  const [folderImportModal, setFolderImportModal] = useState<FolderNode | null>(null)

  const folders = useMemo(() => nodes.filter((node): node is FolderNode => node.type === 'folder'), [nodes])
  const bookmarks = useMemo(() => nodes.filter((node): node is BookmarkNode => node.type === 'bookmark'), [nodes])
  const selectedFolder = typeof selected === 'string' && selected !== ALL_BOOKMARKS ? folders.find((folder) => folder.id === selected) : undefined
  const defaultParent = selectedFolder?.id ?? null

  const reload = useCallback(async () => {
    setNodes(await getAllNodes())
    setLoading(false)
  }, [])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => onLocalChange(() => { void reload() }), [reload])
  useEffect(() => {
    // Opening the popup is a sync trigger; the Service Worker pulls and pushes.
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      void chrome.runtime.sendMessage({ type: 'webwings-sync-trigger' }).catch(() => undefined)
    }
  }, [])
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 2600)
    return () => window.clearTimeout(timer)
  }, [message])

  const selectFolder = (selection: FolderSelection) => {
    setSelected(selection)
  }

  const addCurrentPage = async () => {
    try {
      setBookmarkModal({ open: true, initial: await getCurrentPage() })
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '无法读取当前页面')
    }
  }

  const saveBookmark = async (values: { title: string; url: string; favicon?: string; parentId: string | null }) => {
    const initial = bookmarkModal.initial
    if (initial && 'id' in initial) await putNode({ ...initial, ...values })
    else await createBookmark(values)
    await reload()
    setMessage(initial && 'id' in initial ? '收藏已更新' : '已添加到收藏夹')
  }

  const saveFolder = async (values: { title: string; parentId: string | null }) => {
    if (folderModal.initial) await putNode({ ...folderModal.initial, ...values })
    else {
      const created = await createFolder(values.title, values.parentId)
      setExpanded((current) => {
        const next = new Set(current).add(created.id)
        if (values.parentId) next.add(values.parentId)
        return next
      })
    }
    await reload()
    setMessage(folderModal.initial ? '目录已更新' : '目录已创建')
  }

  const removeFolder = async (folder: FolderNode) => {
    const descendants = getDescendantFolderIds(folders, folder.id)
    const affected = bookmarks.filter((bookmark) => bookmark.parentId === folder.id || (bookmark.parentId && descendants.has(bookmark.parentId))).length
    if (!window.confirm(`确定删除“${folder.title}”吗？其中的 ${affected} 条收藏和所有子目录也会被删除。`)) return
    await deleteNodeTree(folder.id)
    if (selected === folder.id || (typeof selected === 'string' && descendants.has(selected))) setSelected(ALL_BOOKMARKS)
    await reload()
    setMessage('目录已删除')
  }

  const removeBookmark = async (bookmark: BookmarkNode) => {
    if (!window.confirm(`确定删除“${bookmark.title}”吗？`)) return
    await deleteNodeTree(bookmark.id)
    await reload()
    setMessage('收藏已删除')
  }

  const exportFolder = async (folder: FolderNode) => {
    const payload = await exportFolderBookmarks(folder.id)
    downloadPayload(payload, `webwings-${safeFilename(folder.title)}-${dateSuffix()}.json`)
    const exportedBookmarks = payload.nodes.filter((node) => node.type === 'bookmark').length
    setMessage(`已导出“${folder.title}”中的 ${exportedBookmarks} 条收藏`)
  }

  const importData = async (payload: ExportPayload, targetId: string | null) => {
    const imported = await mergeImport(payload, targetId)
    setExpanded((current) => {
      const next = new Set(current)
      if (targetId) next.add(targetId)
      imported.forEach((node) => { if (node.type === 'folder') next.add(node.id) })
      return next
    })
    await reload()
    const count = imported.filter((node) => node.type === 'bookmark').length
    setMessage(`成功导入 ${count} 条收藏`)
  }

  const openFolderDialog = (parentId: string | null) => setFolderModal({ open: true, initial: null, parentId })
  const openFolderImport = (folder: FolderNode) => setFolderImportModal(folder)

  return (
    <div className="flex h-[580px] w-[760px] overflow-hidden bg-background text-foreground">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"><Bookmark className="size-4.5 fill-current" /></div>
          <div><div className="text-sm font-semibold tracking-tight">WebWings</div><div className="text-[10px] text-muted-foreground">让网页井然有序</div></div>
        </div>
        <div className="flex items-center justify-between px-4 pb-2 pt-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">我的目录</span>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => openFolderDialog(defaultParent)} title="新建目录"><FolderPlus className="size-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          <FolderTree
            folders={folders}
            bookmarks={bookmarks}
            selected={selected}
            expanded={expanded}
            onSelect={selectFolder}
            onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })}
            onAdd={(parentId) => { setExpanded((current) => new Set(current).add(parentId)); openFolderDialog(parentId) }}
            onEdit={(folder) => setFolderModal({ open: true, initial: folder, parentId: folder.parentId })}
            onDelete={(folder) => void removeFolder(folder)}
          />
        </div>
        <div className="border-t border-sidebar-border p-2">
          <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={openSettingsPage}>
            <Settings className="size-4" />设置
          </Button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1">
        <BookmarksView
          folders={folders}
          bookmarks={bookmarks}
          selected={selected}
          loading={loading}
          onAddCurrentPage={() => void addCurrentPage()}
          onAddFolder={openFolderDialog}
          onEditBookmark={(bookmark) => setBookmarkModal({ open: true, initial: bookmark })}
          onDeleteBookmark={(bookmark) => void removeBookmark(bookmark)}
          onExportFolder={(folder) => void exportFolder(folder)}
          onImportFolder={openFolderImport}
        />
      </main>

      <BookmarkDialog open={bookmarkModal.open} initial={bookmarkModal.initial} folders={folders} defaultParentId={defaultParent} onOpenChange={(open) => setBookmarkModal((current) => ({ ...current, open }))} onSave={saveBookmark} />
      <FolderDialog open={folderModal.open} initial={folderModal.initial} folders={folders} defaultParentId={folderModal.parentId} onOpenChange={(open) => setFolderModal((current) => ({ ...current, open }))} onSave={saveFolder} />
      <ImportDialog open={folderImportModal !== null} folders={folders} initialTargetId={folderImportModal?.id ?? null} targetLocked onOpenChange={(open) => { if (!open) setFolderImportModal(null) }} onImport={importData} />
      {message && <div className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 rounded-lg bg-foreground px-3.5 py-2 text-xs text-background shadow-xl">{message}</div>}
    </div>
  )
}

export default App
