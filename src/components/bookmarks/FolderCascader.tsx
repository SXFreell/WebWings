import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { availableFolders, folderCascaderColumns, folderDisplayPath, folderPath } from '@/lib/bookmark-tree'
import { cn } from '@/lib/utils'
import type { FolderNode } from '@/types'

interface FolderCascaderProps {
  folders: FolderNode[]
  value: string | null
  onValueChange: (value: string | null) => void
  rootLabel: string
  ariaLabel: string
  excludedIds?: Set<string>
  disabled?: boolean
}

export function FolderCascader({ folders, value, onValueChange, rootLabel, ariaLabel, excludedIds = new Set(), disabled }: FolderCascaderProps) {
  const visibleFolders = useMemo(() => availableFolders(folders, excludedIds), [folders, excludedIds])
  const selectedPath = useMemo(() => folderPath(visibleFolders, value).map((folder) => folder.id), [visibleFolders, value])
  const [open, setOpen] = useState(false)
  const [expandedPath, setExpandedPath] = useState<string[]>(selectedPath)
  const columns = folderCascaderColumns(visibleFolders, expandedPath)
  const displayPath = folderDisplayPath(visibleFolders, value, rootLabel)

  const changeOpen = (nextOpen: boolean) => {
    if (nextOpen) setExpandedPath(selectedPath)
    setOpen(nextOpen)
  }

  const expandAt = (columnIndex: number, folderId: string) => {
    setExpandedPath((current) => [...current.slice(0, columnIndex), folderId])
  }

  const select = (nextValue: string | null) => {
    onValueChange(nextValue)
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={changeOpen}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" aria-label={`${ariaLabel}：${displayPath}`} className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50">
          <span className="truncate">{displayPath}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-[480px] overflow-x-auto p-0">
        <div className="flex divide-x divide-border">
          {columns.map((column, columnIndex) => (
            <div key={columnIndex} role="group" aria-label={`第 ${columnIndex + 1} 级目录`} className="max-h-64 w-40 shrink-0 overflow-y-auto p-1">
              {columnIndex === 0 && (
                <DropdownMenuItem onSelect={() => select(null)}>
                  <Folder />{rootLabel}{value === null && <Check className="ml-auto" />}
                </DropdownMenuItem>
              )}
              {column.map((folder) => {
                const hasChildren = visibleFolders.some((item) => item.parentId === folder.id)
                return (
                  <DropdownMenuItem key={folder.id} onPointerMove={() => hasChildren && expandAt(columnIndex, folder.id)} onSelect={() => select(folder.id)} className={cn(expandedPath[columnIndex] === folder.id && 'bg-accent')}>
                    <Folder /><span className="min-w-0 flex-1 truncate">{folder.title}</span>
                    {value === folder.id ? <Check /> : hasChildren ? <ChevronRight /> : null}
                  </DropdownMenuItem>
                )
              })}
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
