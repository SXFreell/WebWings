import { useEffect, useState } from 'react'
import { FolderCascader } from '@/components/bookmarks/FolderCascader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CurrentPage } from '@/lib/browser'
import type { BookmarkNode, FolderNode } from '@/types'

interface BookmarkDialogProps {
  open: boolean
  initial: BookmarkNode | CurrentPage | null
  folders: FolderNode[]
  defaultParentId: string | null
  onOpenChange: (open: boolean) => void
  onSave: (values: { title: string; url: string; favicon?: string; parentId: string | null }) => Promise<void>
}

export function BookmarkDialog({ open, initial, folders, defaultParentId, onOpenChange, onSave }: BookmarkDialogProps) {
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
            <FolderCascader
              folders={folders}
              value={parentId}
              onValueChange={setParentId}
              rootLabel="未分类"
              ariaLabel="保存到"
            />
          </div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
