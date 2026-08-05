import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Download, KeyRound, Loader2, Plus, RefreshCcw, Trash2, X } from 'lucide-react'
import type { AdminKeySummary } from '@webwings/sync-protocol'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SyncClient } from '@/lib/sync/client'
import { getFreshAccessToken } from '@/lib/sync/engine'
import { readBinding, type BindingRecord } from '@/lib/sync/local-ops'
import { onLocalChange } from '@/lib/sync/notify'

interface RevealedSecret {
  keyId: string
  srkey: string
  action: 'created' | 'rotated' | 'restored'
}

/**
 * Administrator-only Key management. Loads only management metadata from the
 * connected server and never navigates into any Key's namespace content.
 * Full secrets are shown exactly once and never persisted.
 */
export function AdminKeysView() {
  const [binding, setBinding] = useState<BindingRecord | null>(null)
  const [keys, setKeys] = useState<AdminKeySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  const [secret, setSecret] = useState<RevealedSecret | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const active = (await readBinding()) ?? null
    setBinding(active)
    if (!active || active.role !== 'admin' || !active.capabilities.includes('keys:manage')) {
      setKeys([])
      setLoading(false)
      return
    }
    const client = new SyncClient(active.serverUrl)
    const access = await getFreshAccessToken(active, client)
    if (!access.ok) {
      setError(access.message)
      setLoading(false)
      return
    }
    setKeys(await client.adminList(access.token))
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => onLocalChange(() => { void load() }), [load])

  if (!binding || binding.role !== 'admin') return null

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setSecret(null)
    try {
      await work()
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const createKey = () => run(async () => {
    const client = new SyncClient(binding.serverUrl)
    const access = await getFreshAccessToken(binding, client)
    if (!access.ok) throw new Error(access.message)
    const created = await client.adminCreate(access.token, label.trim() || undefined)
    setSecret({ keyId: created.keyId, srkey: created.srkey, action: 'created' })
    setLabel('')
  })

  const rotateKey = (key: AdminKeySummary) => run(async () => {
    if (!window.confirm(`确定轮换 Key ${key.keyPrefix} 吗？轮换后旧 Key 立即失效，所有已连接设备需要重新绑定。`)) return
    const client = new SyncClient(binding.serverUrl)
    const access = await getFreshAccessToken(binding, client)
    if (!access.ok) throw new Error(access.message)
    const rotated = await client.adminRotate(access.token, key.keyId)
    setSecret({ keyId: rotated.keyId, srkey: rotated.srkey, action: 'rotated' })
  })

  const deleteKey = (key: AdminKeySummary) => run(async () => {
    if (!window.confirm(`确定删除 Key ${key.keyPrefix} 吗？其数据将进入待删除保留期，保留期内可恢复；到期后永久删除且不可恢复。`)) return
    const client = new SyncClient(binding.serverUrl)
    const access = await getFreshAccessToken(binding, client)
    if (!access.ok) throw new Error(access.message)
    await client.adminDelete(access.token, key.keyId)
  })

  const restoreKey = (key: AdminKeySummary) => run(async () => {
    if (!window.confirm(`确定恢复待删除的 Key ${key.keyPrefix} 吗？会生成新的完整 Key，旧设备会话不会恢复。`)) return
    const client = new SyncClient(binding.serverUrl)
    const access = await getFreshAccessToken(binding, client)
    if (!access.ok) throw new Error(access.message)
    const restored = await client.adminRestore(access.token, key.keyId)
    setSecret({ keyId: restored.keyId, srkey: restored.srkey, action: 'restored' })
  })

  const downloadSecret = () => {
    if (!secret) return
    const blob = new Blob([`WebWings srkey\n${secret.srkey}\n请立即妥善保存，此完整值只显示一次。\n`], { type: 'text/plain;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `webwings-srkey-${secret.keyId.slice(0, 8)}.txt`
    anchor.click()
    URL.revokeObjectURL(href)
  }

  return (
    <div className="mb-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Key 管理</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">管理同步 Key。完整 Key 只显示一次，请立即保存；数据库只能恢复前缀与状态，无法找回完整秘密。</p>
      </div>

      {secret && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <KeyRound className="size-4" />
              {secret.action === 'created' ? '新 Key 已创建' : secret.action === 'rotated' ? 'Key 已轮换' : 'Key 已恢复'}
            </div>
            <button type="button" className="text-amber-700 hover:text-amber-900" onClick={() => setSecret(null)} aria-label="关闭"><X className="size-4" /></button>
          </div>
          <div className="mt-2 break-all rounded-lg bg-white/70 p-3 font-mono text-xs text-amber-950">{secret.srkey}</div>
          <p className="mt-2 text-xs text-amber-800">完整 Key 仅显示这一次，关闭后无法再次查看。请立即复制或下载保存。</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(secret.srkey); setCopied(true) }}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? '已复制' : '复制'}
            </Button>
            <Button size="sm" variant="outline" onClick={downloadSecret}><Download className="size-4" />下载</Button>
          </div>
        </div>
      )}

      {error && <div className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">{error}</div>}

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex items-end gap-3 border-b p-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="new-key-label">标签（可选）</Label>
            <Input id="new-key-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：工作电脑" />
          </div>
          <Button disabled={busy} onClick={() => void createKey()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}新建 Key
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />加载中…</div>
        ) : keys.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">还没有普通同步 Key</div>
        ) : (
          <ul className="divide-y">
            {keys.map((key) => (
              <li key={key.keyId} className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="font-mono">{key.keyPrefix}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${key.status === 'active' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>
                      {key.status === 'active' ? '正常' : '待删除'}
                    </span>
                    {key.role === 'admin' && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">管理员</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {key.label ?? '未命名'} · {key.deviceCount} 台设备 · {key.nodeCount} 条数据
                    {key.purgeAt ? ` · ${new Date(key.purgeAt).toLocaleDateString('zh-CN')} 永久删除` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {key.status === 'pending_delete' ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void restoreKey(key)}><RefreshCcw className="size-3.5" />恢复</Button>
                  ) : (
                    key.role !== 'admin' && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void rotateKey(key)}><RefreshCcw className="size-3.5" />轮换</Button>
                    )
                  )}
                  {key.role !== 'admin' && (
                    <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={() => void deleteKey(key)}>
                      <Trash2 className="size-3.5" />删除
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">管理员 Key 不能被删除；删除普通 Key 会立即撤销其全部设备与实时连接，数据进入保留期。</p>
    </div>
  )
}
