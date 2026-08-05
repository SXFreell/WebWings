import { useEffect, useMemo, useState } from 'react'
import { FileJson, FolderInput } from 'lucide-react'
import { FolderCascader } from '@/components/bookmarks/FolderCascader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { validateImport } from '@/lib/bookmarks-db'
import { folderPath } from '@/lib/bookmark-tree'
import type { ExportPayload, FolderNode } from '@/types'

interface ImportDialogProps {
  open: boolean
  folders: FolderNode[]
  initialTargetId: string | null
  targetLocked: boolean
  onOpenChange: (open: boolean) => void
  onImport: (payload: ExportPayload, targetId: string | null) => Promise<void>
}

export function ImportDialog({ open, folders, initialTargetId, targetLocked, onOpenChange, onImport }: ImportDialogProps) {
  const [fileName, setFileName] = useState('')
  const [payload, setPayload] = useState<ExportPayload | null>(null)
  const [targetId, setTargetId] = useState<string | null>(initialTargetId)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setFileName('')
    setPayload(null)
    setTargetId(initialTargetId)
    setError('')
    setSubmitting(false)
  }, [open, initialTargetId])

  const summary = useMemo(() => {
    if (!payload) return null
    return {
      folders: payload.nodes.filter((node) => node.type === 'folder').length,
      bookmarks: payload.nodes.filter((node) => node.type === 'bookmark').length,
    }
  }, [payload])

  const targetName = targetId
    ? folderPath(folders, targetId).map((folder) => folder.title).join(' / ') || '目录不存在'
    : '根目录'

  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setPayload(null)
    setError('')
    try {
      const parsed = JSON.parse(await file.text()) as unknown
      validateImport(parsed)
      setPayload(parsed as ExportPayload)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取导入文件')
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!payload) return setError('请先选择有效的 WebWings JSON 文件')
    setSubmitting(true)
    setError('')
    try {
      await onImport(payload, targetId)
      onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入收藏</DialogTitle>
          <DialogDescription>导入内容会合并到目标目录，现有收藏不会被覆盖；所有导入条目都会生成新的 ID。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="import-file">JSON 文件</Label>
            <Input id="import-file" type="file" accept="application/json,.json" onChange={(event) => void chooseFile(event)} />
          </div>
          {fileName && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
              <FileJson className="size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{fileName}</div><div className="text-xs text-muted-foreground">{summary ? `${summary.folders} 个目录，${summary.bookmarks} 条收藏` : '文件校验未通过'}</div></div>
            </div>
          )}
          <div className="space-y-2">
            <Label>导入到</Label>
            {targetLocked ? (
              <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm"><FolderInput className="size-4 text-muted-foreground" /><span className="truncate">{targetName}</span></div>
            ) : (
              <FolderCascader
                folders={folders}
                value={targetId}
                onValueChange={setTargetId}
                rootLabel="根目录"
                ariaLabel="导入到"
              />
            )}
          </div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={!payload || submitting}>{submitting ? '导入中…' : '确认导入'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
