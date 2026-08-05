import { Download, FileJson, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SyncSettingsView } from '@/components/sync/SyncSettingsView'

interface SettingsViewProps {
  folderCount: number
  bookmarkCount: number
  onExportAll: () => void
  onImport: () => void
}

export function SettingsView({ folderCount, bookmarkCount, onExportAll, onImport }: SettingsViewProps) {
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="border-b border-border px-5 py-4">
        <div className="text-[11px] text-muted-foreground">WebWings</div>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight">设置</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <SyncSettingsView />
        <div className="mb-3"><h2 className="text-sm font-semibold">数据管理</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">导出完整备份，或将 WebWings JSON 合并到指定目录。</p></div>
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="flex items-center gap-4 border-b p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Download className="size-5" /></div>
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">导出全部</div><div className="mt-0.5 text-xs text-muted-foreground">{folderCount} 个目录，{bookmarkCount} 条收藏</div></div>
            <Button variant="outline" size="sm" onClick={onExportAll}><Download className="size-4" />导出</Button>
          </div>
          <div className="flex items-center gap-4 p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Upload className="size-5" /></div>
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">导入收藏</div><div className="mt-0.5 text-xs text-muted-foreground">选择根目录或任意目录作为目标</div></div>
            <Button variant="outline" size="sm" onClick={onImport}><Upload className="size-4" />导入</Button>
          </div>
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-muted/60 p-4 text-xs leading-5 text-muted-foreground">
          <FileJson className="mt-0.5 size-4 shrink-0" /><p>导入采用合并模式，不会删除当前数据。系统会更新导入条目的 ID 和父节点 ID，因此同一备份可以重复导入。</p>
        </div>
      </div>
      <footer className="flex h-9 items-center border-t border-border px-5 text-[11px] text-muted-foreground">未连接云端时，数据仅保存在本机 IndexedDB</footer>
    </section>
  )
}
