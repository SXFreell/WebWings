import { Bookmark, ChevronRight, Folder, FolderOpen, FolderPlus, Globe2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ALL_BOOKMARKS, type FolderSelection } from '@/features/bookmarks/constants'
import { getDescendantFolderIds, sortNodes } from '@/lib/bookmark-tree'
import { cn } from '@/lib/utils'
import type { BookmarkNode, FolderNode } from '@/types'

interface FolderTreeProps {
  folders: FolderNode[]
  bookmarks: BookmarkNode[]
  selected: FolderSelection
  expanded: Set<string>
  disabled?: boolean
  onSelect: (id: FolderSelection) => void
  onToggle: (id: string) => void
  onAdd: (parentId: string) => void
  onEdit: (folder: FolderNode) => void
  onDelete: (folder: FolderNode) => void
}

export function FolderTree({ folders, bookmarks, selected, expanded, disabled, onSelect, onToggle, onAdd, onEdit, onDelete }: FolderTreeProps) {
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
          className={cn('group flex h-9 cursor-pointer items-center rounded-md pr-1 text-sm transition-colors hover:bg-sidebar-accent', !disabled && selected === folder.id && 'bg-primary/10 text-primary')}
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
              <button className={cn('flex size-6 items-center justify-center rounded transition-opacity hover:bg-black/5 group-focus-within:opacity-100 group-hover:opacity-100', selected === folder.id && !disabled ? 'opacity-100' : 'opacity-0')} onClick={(event) => event.stopPropagation()} aria-label={`${folder.title}操作`}>
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" sideOffset={5} collisionPadding={10}>
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
      <button className={cn('flex h-9 w-full items-center rounded-md px-2.5 text-sm transition-colors hover:bg-sidebar-accent', !disabled && selected === ALL_BOOKMARKS && 'bg-primary/10 font-medium text-primary')} onClick={() => onSelect(ALL_BOOKMARKS)}>
        <Bookmark className="mr-2 size-4" /><span className="flex-1 text-left">全部收藏</span><span className="text-[11px] tabular-nums text-muted-foreground">{bookmarks.length}</span>
      </button>
      <button className={cn('flex h-9 w-full items-center rounded-md px-2.5 text-sm transition-colors hover:bg-sidebar-accent', !disabled && selected === null && 'bg-primary/10 font-medium text-primary')} onClick={() => onSelect(null)}>
        <Globe2 className="mr-2 size-4" /><span className="flex-1 text-left">未分类</span><span className="text-[11px] tabular-nums text-muted-foreground">{uncategorized}</span>
      </button>
      <div className="pt-1">{renderLevel(null, 0)}</div>
    </div>
  )
}
