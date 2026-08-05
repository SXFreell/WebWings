import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Cloud, Eye, EyeOff, Link2, Loader2, Unplug, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  disconnectBinding,
  migrateActiveBinding,
  resolveConnectionIntent,
  saveCandidateSession,
  startConnection,
} from '@/lib/sync/connection'
import { clearBindSession, readBindSession, readBinding, type BindSessionRecord, type BindingRecord } from '@/lib/sync/local-ops'
import { normalizeServerUrl } from '@/lib/sync/url'
import { onLocalChange } from '@/lib/sync/notify'
import { FirstBindWizard } from './FirstBindWizard'
import { SyncStatusBadge } from './SyncStatusBadge'
import { AdminKeysView } from './AdminKeysView'

export function SyncSettingsView() {
  const [binding, setBinding] = useState<BindingRecord | null>(null)
  const [session, setSession] = useState<BindSessionRecord | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [srkey, setSrkey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const reload = useCallback(async () => {
    setBinding((await readBinding()) ?? null)
    setSession((await readBindSession()) ?? null)
  }, [])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => onLocalChange(() => { void reload() }), [reload])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const maskedKey = useMemo(() => {
    if (!binding) return ''
    const suffix = binding.keyPrefix.replace(/^srk_(admin|sync)_/, '')
    return `${binding.keyPrefix.slice(0, 9)}…${suffix.slice(-4)}`
  }, [binding])

  const connect = async () => {
    setError('')
    setNotice('')
    if (!serverUrl.trim() || !srkey.trim()) {
      setError('请填写服务器地址与 Key')
      return
    }
    let normalized: string
    try {
      normalized = normalizeServerUrl(serverUrl.trim())
    } catch {
      setError('服务器地址无效：需要 https://，或本机调试用的 http://localhost / http://127.0.0.1')
      return
    }
    setBusy(true)
    try {
      const candidate = await startConnection({ serverUrl: normalized, srkey: srkey.trim() })
      const active = (await readBinding()) ?? null
      const intent = resolveConnectionIntent(candidate, active)
      if (intent === 'migration' && active) {
        await migrateActiveBinding(active, candidate)
        setNotice('服务器地址已更新，连接身份未改变')
      } else {
        await saveCandidateSession(candidate)
        setNotice('已连接服务器，首次绑定需要备份与协调')
      }
      await reload()
      if (intent === 'migration' && active) notifyWorker('webwings-sync-trigger')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '连接失败，请重试')
    } finally {
      setSrkey('')
      setShowKey(false)
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!window.confirm('确定断开云同步吗？本地数据不会删除，但会停止上传与接收。')) return
    await disconnectBinding()
    await clearBindSession()
    await reload()
    notifyWorker('webwings-sync-disconnect')
    setNotice('已断开云同步')
  }

  return (
    <div className="mb-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">云端同步</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">连接自建同步服务后，多台设备通过 srkey 即时同步收藏夹。数据始终保存在你控制的服务器上。</p>
      </div>

      {session && !binding ? (
        <FirstBindWizard
          session={session}
          onDone={() => { void (async () => { await reload(); notifyWorker('webwings-sync-trigger'); setNotice('绑定完成，开始同步') })() }}
          onCancel={() => void reload()}
        />
      ) : binding ? (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="flex items-center gap-4 p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600"><Cloud className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span>{binding.role === 'admin' ? '管理员 Key' : '同步 Key'}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{maskedKey}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{binding.serverUrl}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                设备 ·{binding.deviceId.slice(-6)} {binding.lastSyncAt ? `· 上次同步 ${new Date(binding.lastSyncAt).toLocaleString('zh-CN')}` : '· 尚未同步'}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <SyncStatusBadge />
              <Button variant="outline" size="sm" onClick={() => void disconnect()}><Unplug className="size-4" />断开</Button>
            </div>
          </div>
          {session && (
            <div className="border-t px-4 py-3 text-xs text-muted-foreground">
              存在待完成的首次绑定协调：{session.strategy ? `策略 ${session.strategy}` : `步骤 ${session.step}`}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="space-y-3 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="server-url">服务器地址</Label>
              <Input
                id="server-url"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://sync.example.com"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="srkey">srkey</Label>
              <div className="relative">
                <Input
                  id="srkey"
                  type={showKey ? 'text' : 'password'}
                  value={srkey}
                  onChange={(event) => setSrkey(event.target.value)}
                  placeholder="srk_sync_…"
                  autoComplete="off"
                  spellCheck={false}
                  className="pr-9 font-mono"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowKey((current) => !current)}
                  aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                <X className="mt-0.5 size-3.5 shrink-0" />{error}
              </div>
            )}
            {notice && (
              <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs leading-5 text-emerald-700">
                <Check className="mt-0.5 size-3.5 shrink-0" />{notice}
              </div>
            )}
            <Button className="w-full" disabled={busy} onClick={() => void connect()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
              {busy ? '正在连接…' : '连接同步服务'}
            </Button>
            <p className="text-[11px] leading-4 text-muted-foreground">
              连接会先请求该服务器的访问权限，验证服务身份后才提交 Key。Key 只用于本次登记，不会保存在本机。
            </p>
          </div>
        </div>
      )}
      {binding && <AdminKeysView />}
    </div>
  )
}

const notifyWorker = (type: string) => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    void chrome.runtime.sendMessage({ type }).catch(() => undefined)
  }
}
