import { useState } from 'react'
import { Cloud, FileArchive, Loader2, RefreshCcw, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  availableStrategies,
  completeFirstBind,
  isBindSessionExpired,
  prepareBackup,
  retryBind,
  submitBackupProof,
  type BindStrategy,
} from '@/lib/sync/first-bind'
import { clearBindSession, readBindSession, type BindSessionRecord } from '@/lib/sync/local-ops'

interface FirstBindWizardProps {
  session: BindSessionRecord
  onDone: () => void
  onCancel: () => void
}

const STRATEGY_LABELS: Record<BindStrategy, { title: string; description: string }> = {
  initialize_cloud: { title: '初始化云端', description: '云端为空，用本地数据创建云端数据' },
  use_cloud: { title: '使用云端', description: '本地数据替换为云端数据（云端数据已备份）' },
  use_local: { title: '使用本地', description: '云端数据替换为本地数据（本地数据已备份）' },
  merge: { title: '合并', description: '保留云端数据，把本地数据合并进来，重复条目重新编号' },
}

export function FirstBindWizard({ session, onDone, onCancel }: FirstBindWizardProps) {
  const [current, setCurrent] = useState(session)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = async () => {
    const next = await readBindSession()
    if (next) setCurrent(next)
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await work()
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const startBackup = () => run(async () => { await prepareBackup(current) })
  const submitProof = () => run(async () => { await submitBackupProof(current) })

  const chooseStrategy = (strategy: BindStrategy) => run(async () => {
    const result = await completeFirstBind(current, strategy)
    if (result.ok) {
      onDone()
      return
    }
    if (result.reason === 'restart_required') {
      setError(result.message)
      onCancel()
      return
    }
    setError(`${result.message} 请重新导出备份后重试。`)
    await reload()
  })

  const retry = () => run(async () => {
    const result = await retryBind(current, current.cloud.hasData ? 'merge' : 'initialize_cloud')
    if (result.ok) {
      onDone()
      return
    }
    setError(result.message)
    onCancel()
  })

  const cancel = async () => {
    if (!window.confirm('放弃本次绑定吗？已下载的备份 ZIP 会保留在下载目录。')) return
    await clearBindSession()
    onCancel()
  }

  if (isBindSessionExpired(current)) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        绑定会话已过期，请重新连接同步服务。
        <div className="mt-3"><Button size="sm" variant="outline" onClick={() => void cancel()}><X className="size-4" />关闭</Button></div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card shadow-xs">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium"><Cloud className="size-4 text-primary" />首次绑定协调</div>
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => void cancel()} aria-label="放弃绑定"><X className="size-4" /></button>
      </div>

      <div className="space-y-4 p-4">
        <div className="text-xs leading-5 text-muted-foreground">
          绑定前必须完整导出云端与本地数据。备份 ZIP 会下载到你的下载目录，包含
          <span className="font-mono"> manifest.json / cloud.json / local.json </span>
          及 SHA-256 校验值，不包含任何 Key 或凭据。
        </div>

        {error && <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">{error}</div>}

        {current.step === 'started' && (
          <>
            {current.error && (
              <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700">
                {current.error}
                <Button size="sm" variant="outline" className="ml-2" disabled={busy} onClick={retry}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}重新导出并重试
                </Button>
              </div>
            )}
            <Button className="w-full" disabled={busy} onClick={startBackup}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileArchive className="size-4" />}
              开始备份（导出云端与本地全部数据）
            </Button>
          </>
        )}

        {current.step === 'backup_downloaded' && (
          <>
            <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs leading-5 text-emerald-700">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <span>
                备份已下载完成：<span className="font-mono">{current.backupArchiveName}</span><br />
                云端 {current.cloudNodes.length} 项 · 本地 {current.localNodes.length} 项 · 本地修订 {current.localRevision}
              </span>
            </div>
            <Button className="w-full" disabled={busy} onClick={submitProof}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}记录备份凭证
            </Button>
          </>
        )}

        {current.step === 'backup_proven' && (
          <>
            <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs leading-5 text-emerald-700">
              双方数据已备份并记录凭证。选择处理方式：
            </div>
            <div className="space-y-2">
              {availableStrategies(current).map((strategy) => (
                <button
                  key={strategy}
                  type="button"
                  disabled={busy}
                  onClick={() => void chooseStrategy(strategy)}
                  className="w-full rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-60"
                >
                  <div className="text-sm font-medium">{STRATEGY_LABELS[strategy].title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{STRATEGY_LABELS[strategy].description}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {current.step === 'completed' && (
          <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs leading-5 text-emerald-700">绑定完成，开始同步。</div>
        )}
      </div>
    </div>
  )
}
