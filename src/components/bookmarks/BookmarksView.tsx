import { useMemo, useState } from 'react'
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpAZ,
  ArrowUpWideNarrow,
  Bookmark,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  FolderInput,
  FolderPlus,
  Globe2,
  ListFilter,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ALL_BOOKMARKS, type FolderSelection } from '@/features/bookmarks/constants'
import { useBookmarkSort } from '@/hooks/use-bookmark-sort'
import { sortBookmarks, type BookmarkSortMode } from '@/lib/bookmark-sort'
import { folderPath } from '@/lib/bookmark-tree'
import { openBookmark } from '@/lib/browser'
import type { BookmarkNode, FolderNode } from '@/types'

const sortOptions: Array<{ value: BookmarkSortMode; label: string; icon: typeof ListFilter }> = [
  { value: 'default', label: '默认排序', icon: ListFilter },
  { value: 'timeAsc', label: '时间顺序', icon: ArrowUpWideNarrow },
  { value: 'timeDesc', label: '时间倒序', icon: ArrowDownWideNarrow },
  { value: 'titleAsc', label: '标题顺序', icon: ArrowUpAZ },
  { value: 'titleDesc', label: '标题倒序', icon: ArrowDownAZ },
]

interface BookmarksViewProps {
  folders: FolderNode[]
  bookmarks: BookmarkNode[]
  selected: FolderSelection
  loading: boolean
  onAddCurrentPage: () => void
  onAddFolder: (parentId: string | null) => void
  onEditBookmark: (bookmark: BookmarkNode) => void
  onDeleteBookmark: (bookmark: BookmarkNode) => void
  onExportFolder: (folder: FolderNode) => void
  onImportFolder: (folder: FolderNode) => void
}

export function BookmarksView({ folders, bookmarks, selected, loading, onAddCurrentPage, onAddFolder, onEditBookmark, onDeleteBookmark, onExportFolder, onImportFolder }: BookmarksViewProps) {
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useBookmarkSort()
  const selectedFolder = typeof selected === 'string' && selected !== ALL_BOOKMARKS ? folders.find((folder) => folder.id === selected) : undefined
  const pageTitle = selected === ALL_BOOKMARKS ? '收藏夹' : selected === null ? '未分类' : selectedFolder?.title ?? '收藏夹'
  const path = selectedFolder ? folderPath(folders, selectedFolder.id) : []
  const activeSort = sortOptions.find((option) => option.value === sortMode) ?? sortOptions[0]

  const visibleBookmarks = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN')
    let list = bookmarks
    if (selected !== ALL_BOOKMARKS) list = list.filter((bookmark) => bookmark.parentId === selected)
    if (keyword) list = list.filter((bookmark) => `${bookmark.title} ${bookmark.url}`.toLocaleLowerCase('zh-CN').includes(keyword))
    return sortBookmarks(list, sortMode)
  }, [bookmarks, query, selected, sortMode])

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="border-b border-border px-4 pb-3 pt-3.5">
        <div className="mb-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              {path.length > 1 && path.slice(0, -1).map((folder) => <span key={folder.id} className="flex items-center gap-1"><span className="max-w-20 truncate">{folder.title}</span><ChevronRight className="size-3" /></span>)}
              <span>{selected === ALL_BOOKMARKS ? '全部收藏' : selected === null ? '根目录' : '目录'}</span>
            </div>
            <h1 className="truncate text-xl font-semibold tracking-tight">{pageTitle}</h1>
          </div>
          <Button onClick={onAddCurrentPage}><Plus className="size-4" />收藏当前页面</Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="搜索名称或网址" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" className="h-9 max-w-28 px-3"><activeSort.icon className="size-4" /><span className="truncate">{activeSort.label}</span></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {sortOptions.map((option) => <DropdownMenuItem key={option.value} onSelect={() => setSortMode(option.value)}><option.icon />{option.label}{sortMode === option.value && <Check className="ml-auto" />}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="icon" onClick={() => onAddFolder(selectedFolder?.id ?? null)} title="新建目录"><FolderPlus className="size-4" /></Button>
          {selectedFolder && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="icon" title="当前目录操作"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onExportFolder(selectedFolder)}><Download />导出当前目录</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onImportFolder(selectedFolder)}><FolderInput />导入到当前目录</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{bookmark.title}</div><div className="mt-0.5 truncate text-xs text-muted-foreground">{bookmark.url}</div></div>
                <div className="hidden items-center gap-0.5 group-hover:flex" onClick={(event) => event.stopPropagation()}>
                  <Button variant="ghost" size="icon" title="打开" onClick={() => openBookmark(bookmark.url)}><ExternalLink className="size-4" /></Button>
                  <Button variant="ghost" size="icon" title="编辑" onClick={() => onEditBookmark(bookmark)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" className="hover:text-destructive" title="删除" onClick={() => onDeleteBookmark(bookmark)}><Trash2 className="size-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-80 flex-col items-center justify-center px-8 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/8 text-primary"><Bookmark className="size-6" /></div>
            <h2 className="text-sm font-semibold">{query ? '没有找到相关收藏' : '这里还没有收藏'}</h2>
            <p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">{query ? '试试其他关键词，搜索会同时匹配名称和网址。' : '打开想保存的网页，然后点击右上角“收藏当前页面”。'}</p>
            {!query && <Button className="mt-4" variant="outline" size="sm" onClick={onAddCurrentPage}><Plus className="size-4" />添加第一条收藏</Button>}
          </div>
        )}
      </div>
      <footer className="flex h-9 items-center justify-between border-t border-border px-4 text-[11px] text-muted-foreground"><span>{visibleBookmarks.length} 条收藏</span><span>数据仅保存在本机 IndexedDB</span></footer>
    </section>
  )
}
