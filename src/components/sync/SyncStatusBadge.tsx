import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, ShieldAlert, WifiOff } from 'lucide-react'
import { readSyncStatus, type SyncState, type SyncStatusRecord } from '@/lib/sync/local-ops'
import { onLocalChange } from '@/lib/sync/notify'

const ATTENTION_STATES: Partial<Record<SyncState, { label: string; icon: typeof AlertTriangle }>> = {
  offline: { label: '离线，自动重试中', icon: WifiOff },
  auth_failed: { label: '登录失效，请重新连接', icon: ShieldAlert },
  permission_missing: { label: '缺少服务器权限，同步已暂停', icon: ShieldAlert },
  instance_changed: { label: '服务器实例已改变，同步已暂停', icon: ShieldAlert },
  stalled: { label: '同步受阻，自动重试中', icon: AlertTriangle },
}

/**
 * Low-interruption sync indicator. Normal successful sync stays silent;
 * only states that need user attention or active retries are shown.
 */
export function SyncStatusBadge() {
  const [status, setStatus] = useState<SyncStatusRecord | null>(null)

  useEffect(() => {
    const load = () => void readSyncStatus().then((value) => setStatus(value ?? null))
    load()
    return onLocalChange(load)
  }, [])

  if (!status) return null
  if (status.state === 'ok' || status.state === 'idle') return null

  if (status.state === 'syncing') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />同步中
      </span>
    )
  }

  const attention = ATTENTION_STATES[status.state]
  if (!attention) return null
  const Icon = attention.icon
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700">
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{attention.label}</span>
    </span>
  )
}
