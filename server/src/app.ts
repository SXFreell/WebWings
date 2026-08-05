import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import websocket from '@fastify/websocket'
import type pg from 'pg'
import {
  PROTOCOL_MIN_CLIENT_VERSION,
  PROTOCOL_SERVICE,
  PROTOCOL_VERSION,
  backupProofSchema,
  bindStartRequestSchema,
  parseBindComplete,
  parsePushRequest,
} from '@webwings/sync-protocol'
import { z } from 'zod'
import type { ServerConfig } from './config'
import { ApiError } from './errors'
import { BindService } from './services/bind'
import { KeyService } from './keys'
import { OperationService } from './services/operations'
import { SyncService } from './services/sync'
import { ProtocolError } from '@webwings/sync-protocol'
import type { RateLimiter } from './rateLimit'
import { RealtimeHub } from './realtime'
import { SessionService, type AuthContext } from './sessions'
import type { Logger } from './logger'

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
  }
}

export interface AppDeps {
  pool: pg.Pool
  config: ServerConfig
  logger: Logger
  instanceId: string
  bindLimiter: RateLimiter
  sessionService: SessionService
  keyService: KeyService
  bindService: BindService
  operationService: OperationService
  syncService: SyncService
  realtime: RealtimeHub
}

const errorBody = (code: string, message: string) => ({ error: { code, message } })

export const buildApp = (deps: AppDeps): FastifyInstance => {
  const app = Fastify({
    logger: false,
    bodyLimit: deps.config.maxBodyBytes,
  })
  app.register(websocket)

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send(errorBody(error.code, error.message))
    }
    if (error instanceof ProtocolError) {
      return reply.status(400).send(errorBody(error.code, error.message))
    }
    if (error && typeof error === 'object' && 'statusCode' in error && (error as { statusCode?: unknown }).statusCode === 413) {
      return reply.status(413).send(errorBody('payload_too_large', 'payload too large'))
    }
    deps.logger.error('unhandled request error', { error: error instanceof Error ? error.message : String(error) })
    return reply.status(500).send(errorBody('internal_error', 'internal error'))
  })

  const authenticate = async (request: FastifyRequest): Promise<AuthContext | null> => {
    const header = request.headers.authorization
    if (!header?.startsWith('Bearer ')) return null
    return deps.sessionService.authenticateAccess(header.slice('Bearer '.length))
  }

  const requireAuth = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> => {
    const ctx = await authenticate(request)
    if (!ctx) {
      return reply.code(401).send(errorBody('unauthorized', 'unauthorized'))
    }
    request.auth = ctx
    return undefined
  }

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> => {
    const result = await requireAuth(request, reply)
    if (result !== undefined) return result
    if (request.auth!.role !== 'admin') {
      return reply.code(403).send(errorBody('forbidden', 'administrator privileges required'))
    }
    return undefined
  }

  app.get('/healthz', async () => ({ status: 'ok' }))
  app.get('/readyz', async () => {
    await deps.pool.query('select 1')
    return { status: 'ready' }
  })

  app.get('/v1/info', async () => ({
    service: PROTOCOL_SERVICE,
    apiVersion: PROTOCOL_VERSION,
    instanceId: deps.instanceId,
    serverTime: new Date().toISOString(),
    minClientVersion: PROTOCOL_MIN_CLIENT_VERSION,
    features: ['sync', 'realtime', 'snapshots', 'admin_keys'],
  }))

  app.post('/v1/bind/start', async (request, reply) => {
    if (!deps.bindLimiter.check(request.ip)) {
      return reply.code(429).send(errorBody('rate_limited', 'too many bind attempts; try again later'))
    }
    const parsed = bindStartRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorBody('invalid_bind_request', 'invalid bind request'))
    return deps.bindService.start(parsed.data)
  })

  const requireBindToken = async (request: FastifyRequest, reply: { code: (status: number) => { send: (body: unknown) => void } }) => {
    const header = request.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      reply.code(401).send(errorBody('unauthorized', 'unauthorized'))
      return null
    }
    return header.slice('Bearer '.length)
  }

  app.get('/v1/bind/:sessionId/cloud-snapshot', async (request, reply) => {
    const token = await requireBindToken(request, reply)
    if (!token) return
    return deps.bindService.cloudSnapshot(token, (request.params as { sessionId: string }).sessionId)
  })

  app.post('/v1/bind/:sessionId/backup-proof', async (request, reply) => {
    const token = await requireBindToken(request, reply)
    if (!token) return
    const parsed = backupProofSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorBody('invalid_backup_proof', 'invalid backup proof'))
    await deps.bindService.backupProof(token, (request.params as { sessionId: string }).sessionId, parsed.data)
    return { v: 1, status: 'ok' }
  })

  app.post('/v1/bind/:sessionId/complete', async (request, reply) => {
    const token = await requireBindToken(request, reply)
    if (!token) return
    let requestBody
    try {
      requestBody = parseBindComplete(request.body)
    } catch {
      return reply.code(400).send(errorBody('invalid_bind_request', 'invalid bind request'))
    }
    return deps.bindService.complete(token, (request.params as { sessionId: string }).sessionId, requestBody)
  })

  app.post('/v1/auth/refresh', async (request, reply) => {
    const schema = z.object({ refreshToken: z.string().min(1) })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorBody('invalid_request', 'refreshToken is required'))
    const issued = await deps.sessionService.refresh(parsed.data.refreshToken)
    if (!issued) return reply.code(401).send(errorBody('unauthorized', 'invalid or revoked refresh token'))
    return issued
  })

  app.post('/v1/auth/revoke', { preHandler: (request, reply) => requireAuth(request, reply) }, async (request, reply) => {
    const ctx = request.auth
    if (!ctx) return reply.code(401).send(errorBody('unauthorized', 'unauthorized'))
    await deps.sessionService.revoke(ctx.sessionId)
    return { v: 1, status: 'ok' }
  })

  app.post('/v1/sync/push', { preHandler: (request, reply) => requireAuth(request, reply) }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send(errorBody('unauthorized', 'unauthorized'))
    let requestBody
    try {
      requestBody = parsePushRequest(request.body)
    } catch {
      return reply.code(400).send(errorBody('invalid_push_request', 'invalid push request'))
    }
    const receipts = await deps.syncService.push(request.auth, requestBody.ops)
    return { v: 1, receipts }
  })

  app.get('/v1/sync/pull', { preHandler: (request, reply) => requireAuth(request, reply) }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send(errorBody('unauthorized', 'unauthorized'))
    const query = request.query as { after?: string; limit?: string; epoch?: string }
    const after = Number(query.after ?? '0')
    const limit = Number(query.limit ?? '200')
    const epoch = query.epoch === undefined ? undefined : Number(query.epoch)
    if (!Number.isInteger(after) || !Number.isInteger(limit) || limit < 1 || limit > 500) {
      return reply.code(400).send(errorBody('invalid_request', 'invalid after/limit'))
    }
    return deps.syncService.pull(request.auth, { after, limit, epoch })
  })

  app.get('/v1/sync/snapshot', { preHandler: (request, reply) => requireAuth(request, reply) }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send(errorBody('unauthorized', 'unauthorized'))
    return deps.syncService.snapshot(request.auth)
  })

  app.get('/v1/admin/keys', { preHandler: (request, reply) => requireAdmin(request, reply) }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send(errorBody('unauthorized', 'unauthorized'))
    return deps.keyService.listForAdmin(request.auth.role)
  })

  app.post('/v1/admin/keys', { preHandler: (request, reply) => requireAdmin(request, reply) }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send(errorBody('unauthorized', 'unauthorized'))
    const schema = z.object({ label: z.string().max(200).optional() })
    const parsed = schema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send(errorBody('invalid_request', 'invalid label'))
    return deps.keyService.createKey(request.auth.role, parsed.data.label)
  })

  app.post('/v1/admin/keys/:keyId/rotate', { preHandler: (request, reply) => requireAdmin(request, reply) }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send(errorBody('unauthorized', 'unauthorized'))
    const { keyId } = request.params as { keyId: string }
    const result = await deps.keyService.rotateKey(request.auth.role, keyId)
    deps.realtime.revokeKey(keyId)
    return result
  })

  app.post('/v1/admin/keys/:keyId/delete', { preHandler: (request, reply) => requireAdmin(request, reply) }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send(errorBody('unauthorized', 'unauthorized'))
    const { keyId } = request.params as { keyId: string }
    await deps.keyService.deleteKey(request.auth.role, keyId)
    deps.realtime.revokeKey(keyId)
    return { v: 1, status: 'ok' }
  })

  app.post('/v1/admin/keys/:keyId/restore', { preHandler: (request, reply) => requireAdmin(request, reply) }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send(errorBody('unauthorized', 'unauthorized'))
    const { keyId } = request.params as { keyId: string }
    return deps.keyService.restoreKey(request.auth.role, keyId)
  })

  app.get('/v1/realtime', { websocket: true }, (socket, request) => {
    const query = request.query as { token?: string }
    void deps.sessionService.authenticateAccess(query.token ?? '').then((ctx) => {
      if (!ctx) {
        socket.close(4401, 'unauthorized')
        return
      }
      const unregister = deps.realtime.register(ctx.namespaceId, ctx.keyId, socket)
      socket.on('close', unregister)
      socket.on('error', unregister)
    })
  })

  return app
}
