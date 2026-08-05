import { PROTOCOL_MIN_CLIENT_VERSION, PROTOCOL_SERVICE, PROTOCOL_VERSION, parseServiceInfo } from '@webwings/sync-protocol'
import { ApiClientError, SyncClient } from './client'

export interface DiscoveryResult {
  ok: true
  instanceId: string
  apiVersion: number
  minClientVersion: string
  features: string[]
}

export type DiscoveryFailure =
  | { ok: false; code: 'network' | 'incompatible' | 'version_too_old' | 'invalid'; message: string }

/**
 * Anonymous service discovery. Never submits the srkey until identity and
 * version validation succeed.
 */
export const discover = async (serverUrl: string): Promise<DiscoveryResult | DiscoveryFailure> => {
  const client = new SyncClient(serverUrl)
  let raw: unknown
  try {
    raw = await client.info()
  } catch (error) {
    if (error instanceof ApiClientError && error.status > 0) {
      return { ok: false, code: 'invalid', message: '该地址不是兼容的 WebWings 同步服务' }
    }
    return { ok: false, code: 'network', message: '无法连接到服务器，请检查地址与网络' }
  }
  try {
    const info = parseServiceInfo(raw)
    if (info.service !== PROTOCOL_SERVICE) {
      return { ok: false, code: 'incompatible', message: '该服务不是 WebWings 同步服务' }
    }
    if (info.apiVersion !== PROTOCOL_VERSION) {
      return { ok: false, code: 'incompatible', message: `不支持的协议版本 ${info.apiVersion}` }
    }
    if (compareVersions(PROTOCOL_MIN_CLIENT_VERSION, info.minClientVersion) < 0) {
      return { ok: false, code: 'version_too_old', message: '插件版本过旧，请更新 WebWings 后重试' }
    }
    return {
      ok: true,
      instanceId: info.instanceId,
      apiVersion: info.apiVersion,
      minClientVersion: info.minClientVersion,
      features: info.features,
    }
  } catch {
    // The strict protocol schema rejects mismatches up front; classify those
    // as incompatible instead of "unrecognized data" so the UI can explain
    // the actual problem. Only a well-formed service-info payload is eligible
    // for that classification; anything else is malformed data.
    if (isRecord(raw) &&
        typeof raw.service === 'string' &&
        typeof raw.apiVersion === 'number' &&
        typeof raw.instanceId === 'string' &&
        typeof raw.serverTime === 'string' &&
        typeof raw.minClientVersion === 'string') {
      if (raw.service !== undefined && raw.service !== PROTOCOL_SERVICE) {
        return { ok: false, code: 'incompatible', message: '该服务不是 WebWings 同步服务' }
      }
      if (raw.apiVersion !== PROTOCOL_VERSION) {
        return { ok: false, code: 'incompatible', message: `不支持的协议版本 ${raw.apiVersion}` }
      }
    }
    return { ok: false, code: 'invalid', message: '该服务返回了无法识别的数据' }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map((part) => Number(part))
  const pb = b.split('.').map((part) => Number(part))
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const difference = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
