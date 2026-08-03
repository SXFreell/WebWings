import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bookmark,
  ChevronRight,
  Download,
  ExternalLink,
  FileJson,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe2,
  Import,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getCurrentPage, openBookmark, type CurrentPage } from '@/lib/browser'
import {
  createBookmark,
  createFolder,
  deleteNodeTree,
  exportBookmarks,
  getAllNodes,
  putNode,
  replaceAllNodes,
  validateImport,
} from '@/lib/bookmarks-db'
import { cn } from '@/lib/utils'
import type { BookmarkNode, FavoriteNode, FolderNode } from '@/types'

const ALL_BOOKMARKS = '__all__'
const ROOT_FOLDER = '__root__'
type FolderSelection = typeof ALL_BOOKMARKS | string | null

const sortNodes = <T extends FavoriteNode>(nodes: T[]) => [...nodes].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'))

const getDescendantFolderIds = (folders: FolderNode[], folderId: string) => {
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

const folderPath = (folders: FolderNode[], id: string | null) => {
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

const flattenFolders = (folders: FolderNode[], excluded = new Set<string>()) => {
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

interface FolderTreeProps {
  folders: FolderNode[]
  bookmarks: BookmarkNode[]
  selected: FolderSelection
  expanded: Set<string>
  onSelect: (id: FolderSelection) => void
  onToggle: (id: string) => void
  onAdd: (parentId: string | null) => void
  onEdit: (folder: FolderNode) => void
  onDelete: (folder: FolderNode) => void
}

function FolderTree({ folders, bookmarks, selected, expanded, onSelect, onToggle, onAdd, onEdit, onDelete }: FolderTreeProps) {
  const countFor = (folderId: string) => {
    const ids = getDescendantFolderIds(folders, folderId)
    ids.add(folderId)
    return bookmarks.filter((bookmark) => bookmark.parentId && ids.has(bookmark.parentId)).length
  }

  const renderLevel = (parentId: string | null, depth: number) => sortNodes(folders.filter((folder) => folder.parentId === parentId)).map((folder) => {
    const hasChildren = folders.some((item) => item.parentId === folder.id)
    const isOpen = expanded.has(folder.id)
    return (
      <div key={folder.id}>
        <div
          className={cn('group flex h-9 cursor-pointer items-center rounded-md pr-1 text-sm transition-colors hover:bg-sidebar-accent', selected === folder.id && 'bg-primary/10 text-primary')}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => onSelect(folder.id)}
        >
          <button
            className={cn('mr-0.5 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-black/5', !hasChildren && 'invisible')}
            onClick={(event) => { event.stopPropagation(); onToggle(folder.id) }}
            aria-label={isOpen ? '收起目录' : '展开目录'}
          >
            <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
          </button>
          {isOpen ? <FolderOpen className="mr-2 size-4 shrink-0" /> : <Folder className="mr-2 size-4 shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{folder.title}</span>
          <span className="mr-1 text-[11px] tabular-nums text-muted-foreground group-hover:hidden">{countFor(folder.id)}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="hidden size-6 items-center justify-center rounded hover:bg-black/5 group-hover:flex" onClick={(event) => event.stopPropagation()} aria-label={`${folder.title}操作`}>
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right">
              <DropdownMenuItem onSelect={() => onAdd(folder.id)}><FolderPlus />新建子目录</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onEdit(folder)}><Pencil />编辑目录</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete(folder)}><Trash2 />删除目录</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {isOpen && renderLevel(folder.id, depth + 1)}
      </div>
    )
  })

  const uncategorized = bookmarks.filter((bookmark) => bookmark.parentId === null).length
  return (
    <div className="space-y-0.5 px-2">
      <button className={cn('flex h-9 w-full items-center rounded-md px-2.5 text-sm transition-colors hover:bg-sidebar-accent', selected === ALL_BOOKMARKS && 'bg-primary/10 font-medium text-primary')} onClick={() => onSelect(ALL_BOOKMARKS)}>
        <Bookmark className="mr-2 size-4" />
        <span className="flex-1 text-left">全部收藏</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{bookmarks.length}</span>
      </button>
      <button className={cn('flex h-9 w-full items-center rounded-md px-2.5 text-sm transition-colors hover:bg-sidebar-accent', selected === null && 'bg-primary/10 font-medium text-primary')} onClick={() => onSelect(null)}>
        <Globe2 className="mr-2 size-4" />
        <span className="flex-1 text-left">未分类</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{uncategorized}</span>
      </button>
      <div className="pt-1">{renderLevel(null, 0)}</div>
    </div>
  )
}

interface BookmarkDialogProps {
  open: boolean
  initial: BookmarkNode | CurrentPage | null
  folders: FolderNode[]
  defaultParentId: string | null
  onOpenChange: (open: boolean) => void
  onSave: (values: { title: string; url: string; favicon?: string; parentId: string | null }) => Promise<void>
}

function BookmarkDialog({ open, initial, folders, defaultParentId, onOpenChange, onSave }: BookmarkDialogProps) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [favicon, setFavicon] = useState<string | undefined>()
  const [parentId, setParentId] = useState<string | null>(defaultParentId)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const editing = Boolean(initial && 'id' in initial)

  useEffect(() => {
    if (!open) return
    setTitle(initial?.title ?? '')
    setUrl(initial?.url ?? '')
    setFavicon(initial?.favicon)
    setParentId(initial && 'id' in initial ? initial.parentId : defaultParentId)
    setError('')
  }, [open, initial, defaultParentId])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const cleanTitle = title.trim()
    const cleanUrl = url.trim()
    if (!cleanTitle) return setError('请输入收藏名称')
    try {
      const parsed = new URL(cleanUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
    } catch {
      return setError('请输入有效的 http 或 https 链接')
    }
    setSaving(true)
    setError('')
    try {
      await onSave({ title: cleanTitle, url: cleanUrl, favicon, parentId })
      onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? '编辑收藏' : '添加收藏'}</DialogTitle>
          <DialogDescription>{editing ? '修改名称、链接或所在目录。' : '确认当前页面信息并选择保存位置。'}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2"><Label htmlFor="bookmark-title">名称</Label><Input id="bookmark-title" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus /></div>
          <div className="space-y-2"><Label htmlFor="bookmark-url">链接</Label><Input id="bookmark-url" value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} /></div>
          <div className="space-y-2">
            <Label>保存到</Label>
            <Select value={parentId ?? ROOT_FOLDER} onValueChange={(value) => setParentId(value === ROOT_FOLDER ? null : value)}>
              <SelectTrigger><SelectValue placeholder="选择目录" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT_FOLDER}>未分类</SelectItem>
                {flattenFolders(folders).map(({ folder, depth }) => <SelectItem key={folder.id} value={folder.id}>{'　'.repeat(depth)}{folder.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface FolderDialogProps {
  open: boolean
  initial: FolderNode | null
  folders: FolderNode[]
  defaultParentId: string | null
  onOpenChange: (open: boolean) => void
  onSave: (values: { title: string; parentId: string | null }) => Promise<void>
}

function FolderDialog({ open, initial, folders, defaultParentId, onOpenChange, onSave }: FolderDialogProps) {
  const [title, setTitle] = useState('')
  const [parentId, setParentId] = useState<string | null>(defaultParentId)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    setTitle(initial?.title ?? '')
    setParentId(initial?.parentId ?? defaultParentId)
    setError('')
  }, [open, initial, defaultParentId])

  const excluded = initial ? getDescendantFolderIds(folders, initial.id) : new Set<string>()
  if (initial) excluded.add(initial.id)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return setError('请输入目录名称')
    setSaving(true)
    setError('')
    try {
      await onSave({ title: title.trim(), parentId })
      onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{initial ? '编辑目录' : '新建目录'}</DialogTitle><DialogDescription>目录可以无限层级嵌套，之后也可以移动。</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2"><Label htmlFor="folder-title">目录名称</Label><Input id="folder-title" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus /></div>
          <div className="space-y-2">
            <Label>上级目录</Label>
            <Select value={parentId ?? ROOT_FOLDER} onValueChange={(value) => setParentId(value === ROOT_FOLDER ? null : value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT_FOLDER}>根目录</SelectItem>
                {flattenFolders(folders, excluded).map(({ folder, depth }) => <SelectItem key={folder.id} value={folder.id}>{'　'.repeat(depth)}{folder.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function App() {
  const [nodes, setNodes] = useState<FavoriteNode[]>([])
  const [selected, setSelected] = useState<FolderSelection>(ALL_BOOKMARKS)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [bookmarkModal, setBookmarkModal] = useState<{ open: boolean; initial: BookmarkNode | CurrentPage | null }>({ open: false, initial: null })
  const [folderModal, setFolderModal] = useState<{ open: boolean; initial: FolderNode | null; parentId: string | null }>({ open: false, initial: null, parentId: null })
  const importRef = useRef<HTMLInputElement>(null)

  const folders = useMemo(() => nodes.filter((node): node is FolderNode => node.type === 'folder'), [nodes])
  const bookmarks = useMemo(() => nodes.filter((node): node is BookmarkNode => node.type === 'bookmark'), [nodes])

  const reload = useCallback(async () => {
    setNodes(await getAllNodes())
    setLoading(false)
  }, [])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 2400)
    return () => window.clearTimeout(timer)
  }, [message])

  const visibleBookmarks = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN')
    let list = bookmarks
    if (selected !== ALL_BOOKMARKS) list = list.filter((bookmark) => bookmark.parentId === selected)
    if (keyword) list = list.filter((bookmark) => `${bookmark.title} ${bookmark.url}`.toLocaleLowerCase('zh-CN').includes(keyword))
    return sortNodes(list).reverse()
  }, [bookmarks, query, selected])

  const selectedFolder = typeof selected === 'string' && selected !== ALL_BOOKMARKS ? folders.find((folder) => folder.id === selected) : undefined
  const pageTitle = selected === ALL_BOOKMARKS ? '收藏夹' : selected === null ? '未分类' : selectedFolder?.title ?? '收藏夹'
  const defaultParent = selectedFolder?.id ?? null

  const addCurrentPage = async () => {
    try {
      const page = await getCurrentPage()
      setBookmarkModal({ open: true, initial: page })
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
      setExpanded((current) => new Set(current).add(created.id).add(values.parentId ?? ''))
    }
    await reload()
    setMessage(folderModal.initial ? '目录已更新' : '目录已创建')
  }

  const removeFolder = async (folder: FolderNode) => {
    const descendants = getDescendantFolderIds(folders, folder.id)
    const affected = bookmarks.filter((bookmark) => bookmark.parentId === folder.id || (bookmark.parentId && descendants.has(bookmark.parentId))).length
    if (!window.confirm(`确定删除“${folder.title}”吗？其中的 ${affected} 条收藏和所有子目录也会被删除。`)) return
    await deleteNodeTree(folder.id)
    if (selected === folder.id || descendants.has(selected as string)) setSelected(ALL_BOOKMARKS)
    await reload()
    setMessage('目录已删除')
  }

  const removeBookmark = async (bookmark: BookmarkNode) => {
    if (!window.confirm(`确定删除“${bookmark.title}”吗？`)) return
    await deleteNodeTree(bookmark.id)
    await reload()
    setMessage('收藏已删除')
  }

  const downloadJson = async () => {
    const payload = await exportBookmarks()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `webwings-bookmarks-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(href)
    setMessage(`已导出 ${bookmarks.length} 条收藏`)
  }

  const importJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const imported = validateImport(JSON.parse(await file.text()))
      const importedBookmarks = imported.filter((node) => node.type === 'bookmark').length
      if (!window.confirm(`将导入 ${importedBookmarks} 条收藏，并替换当前数据。是否继续？`)) return
      await replaceAllNodes(imported)
      setSelected(ALL_BOOKMARKS)
      setExpanded(new Set(imported.filter((node) => node.type === 'folder').map((node) => node.id)))
      await reload()
      setMessage('收藏夹导入成功')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '导入失败')
    }
  }

  const path = selectedFolder ? folderPath(folders, selectedFolder.id) : []

  return (
    <div className="flex h-[580px] w-[760px] overflow-hidden bg-background text-foreground">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"><Bookmark className="size-4.5 fill-current" /></div>
          <div><div className="text-sm font-semibold tracking-tight">WebWings</div><div className="text-[10px] text-muted-foreground">让网页井然有序</div></div>
        </div>
        <div className="flex items-center justify-between px-4 pb-2 pt-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">我的目录</span>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setFolderModal({ open: true, initial: null, parentId: defaultParent })} title="新建目录"><FolderPlus className="size-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          <FolderTree
            folders={folders}
            bookmarks={bookmarks}
            selected={selected}
            expanded={expanded}
            onSelect={setSelected}
            onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })}
            onAdd={(parentId) => { if (parentId) setExpanded((current) => new Set(current).add(parentId)); setFolderModal({ open: true, initial: null, parentId }) }}
            onEdit={(folder) => setFolderModal({ open: true, initial: folder, parentId: folder.parentId })}
            onDelete={(folder) => void removeFolder(folder)}
          />
        </div>
        <div className="border-t border-sidebar-border p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" className="w-full justify-start text-muted-foreground"><FileJson className="size-4" />数据管理<MoreHorizontal className="ml-auto size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-[200px]">
              <DropdownMenuItem onSelect={() => void downloadJson()}><Download />导出 JSON</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => importRef.current?.click()}><Upload />导入 JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input ref={importRef} className="hidden" type="file" accept="application/json,.json" onChange={(event) => void importJson(event)} />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="border-b border-border px-4 pb-3 pt-3.5">
          <div className="mb-3 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                {path.length > 1 && path.slice(0, -1).map((folder) => <span key={folder.id} className="flex items-center gap-1"><span className="max-w-20 truncate">{folder.title}</span><ChevronRight className="size-3" /></span>)}
                <span>{selected === ALL_BOOKMARKS ? '全部收藏' : selected === null ? '根目录' : '目录'}</span>
              </div>
              <h1 className="truncate text-xl font-semibold tracking-tight">{pageTitle}</h1>
            </div>
            <Button onClick={() => void addCurrentPage()}><Plus className="size-4" />收藏当前页面</Button>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="搜索名称或网址" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
            <Button variant="outline" size="icon" onClick={() => setFolderModal({ open: true, initial: null, parentId: defaultParent })} title="新建目录"><FolderPlus className="size-4" /></Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="icon" title="更多操作"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void downloadJson()}><Download />导出 JSON</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => importRef.current?.click()}><Import />导入 JSON</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-[58px] animate-pulse rounded-lg bg-muted" />)}</div>
          ) : visibleBookmarks.length ? (
            <div className="divide-y divide-border">
              {visibleBookmarks.map((bookmark) => (
                <div key={bookmark.id} className="group flex min-h-[66px] cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60" onClick={() => openBookmark(bookmark.url)}>
                  <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card shadow-xs">
                    {bookmark.favicon ? <img src={bookmark.favicon} className="size-5" alt="" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <Globe2 className="size-4 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{bookmark.title}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{bookmark.url}</div>
                  </div>
                  <div className="hidden items-center gap-0.5 group-hover:flex" onClick={(event) => event.stopPropagation()}>
                    <Button variant="ghost" size="icon" title="打开" onClick={() => openBookmark(bookmark.url)}><ExternalLink className="size-4" /></Button>
                    <Button variant="ghost" size="icon" title="编辑" onClick={() => setBookmarkModal({ open: true, initial: bookmark })}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="hover:text-destructive" title="删除" onClick={() => void removeBookmark(bookmark)}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full min-h-80 flex-col items-center justify-center px-8 text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/8 text-primary"><Bookmark className="size-6" /></div>
              <h2 className="text-sm font-semibold">{query ? '没有找到相关收藏' : '这里还没有收藏'}</h2>
              <p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">{query ? '试试其他关键词，搜索会同时匹配名称和网址。' : '打开想保存的网页，然后点击右上角“收藏当前页面”。'}</p>
              {!query && <Button className="mt-4" variant="outline" size="sm" onClick={() => void addCurrentPage()}><Plus className="size-4" />添加第一条收藏</Button>}
            </div>
          )}
        </div>
        <footer className="flex h-9 items-center justify-between border-t border-border px-4 text-[11px] text-muted-foreground">
          <span>{visibleBookmarks.length} 条收藏</span><span>数据仅保存在本机 IndexedDB</span>
        </footer>
      </main>

      <BookmarkDialog
        open={bookmarkModal.open}
        initial={bookmarkModal.initial}
        folders={folders}
        defaultParentId={defaultParent}
        onOpenChange={(open) => setBookmarkModal((current) => ({ ...current, open }))}
        onSave={saveBookmark}
      />
      <FolderDialog
        open={folderModal.open}
        initial={folderModal.initial}
        folders={folders}
        defaultParentId={folderModal.parentId}
        onOpenChange={(open) => setFolderModal((current) => ({ ...current, open }))}
        onSave={saveFolder}
      />
      {message && <div className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 rounded-lg bg-foreground px-3.5 py-2 text-xs text-background shadow-xl">{message}</div>}
    </div>
  )
}

export default App
