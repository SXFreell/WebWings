const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Normalizes a user-supplied Server URL into an API root:
 * - keeps a valid subpath, strips trailing slashes
 * - rejects credentials, query strings, fragments and hashes
 * - HTTPS always; HTTP only for loopback hosts
 */
export const normalizeServerUrl = (input: string): string => {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('服务器地址无效，请输入完整的 http(s) 地址')
  }
  if (url.username || url.password) throw new Error('服务器地址不能包含用户名或密码')
  if (url.search) throw new Error('服务器地址不能包含查询参数')
  if (url.hash) throw new Error('服务器地址不能包含片段')
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('服务器地址必须使用 http 或 https')
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new Error('非本机地址必须使用 HTTPS')
  }
  const base = `${url.protocol}//${url.host}${url.pathname}`
  return base.replace(/\/+$/, '')
}

export const isLoopbackHost = (hostname: string): boolean => {
  const normalized = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
  return LOOPBACK_HOSTS.has(normalized.toLowerCase()) || normalized.toLowerCase() === 'localhost'
}

export const originOf = (serverUrl: string): string => {
  const url = new URL(serverUrl)
  return url.origin
}

export const hostPermissionOf = (serverUrl: string): string => {
  const url = new URL(serverUrl)
  return `${url.origin}/*`
}
