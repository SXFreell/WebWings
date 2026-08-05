import { useEffect, useState } from 'react'
import { FolderCascader } from '@/components/bookmarks/FolderCascader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getDescendantFolderIds } from '@/lib/bookmark-tree'
import type { FolderNode } from '@/types'

interface FolderDialogProps {
  open: boolean
  initial: FolderNode | null
  folders: FolderNode[]
  defaultParentId: string | null
  onOpenChange: (open: boolean) => void
  onSave: (values: { title: string; parentId: string | null }) => Promise<void>
}

export function FolderDialog({ open, initial, folders, defaultParentId, onOpenChange, onSave }: FolderDialogProps) {
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
            <FolderCascader
              folders={folders}
              value={parentId}
              onValueChange={setParentId}
              rootLabel="根目录"
              ariaLabel="上级目录"
              excludedIds={excluded}
            />
          </div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
