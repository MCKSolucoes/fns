import { Hono, type MiddlewareHandler } from 'hono'
import { createHash } from 'node:crypto'
import type { ServerConfig } from './config.js'

export interface AuthUser {
  id: string
  nome: string | null
  cargo: string
}

export interface AuthEnv {
  Variables: {
    user?: AuthUser
  }
}

interface Logger {
  info(message: string): void
  error(message: string): void
}

interface CachedIdentity {
  expiresAt: number
  user: AuthUser
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CACHE_ENTRIES = 500
const CACHE_TTL_MS = 60_000

export class AuthError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function parseJwtExpMs(token: string): number | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
    if (typeof payload.exp === 'number') {
      return payload.exp * 1000
    }
  } catch {
    // ignorar falha ao ler exp do token
  }
  return null
}

function isTimeoutOrNetworkError(error: unknown): boolean {
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) {
    return true
  }
  if (error instanceof TypeError) return true
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string' && ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
      return true
    }
  }
  return false
}

export function createAuth(
  config: ServerConfig,
  fetcher: typeof fetch = fetch,
  logger: Logger = console,
) {
  const identityCache = new Map<string, CachedIdentity>()

  async function resolveIdentity(token: string): Promise<AuthUser> {
    const hash = createHash('sha256').update(token).digest('hex')
    const now = Date.now()
    const cached = identityCache.get(hash)
    if (cached && cached.expiresAt > now) {
      return cached.user
    }

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new AuthError(503, 'AUTH_NOT_CONFIGURED', 'A conexão de autenticação não foi configurada.')
    }

    let userResponse: Response
    try {
      userResponse = await fetcher(`${config.supabaseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': 'MCK-FNS/1.0',
        },
        signal: AbortSignal.timeout(8000),
        redirect: 'manual',
      })
    } catch (err) {
      if (isTimeoutOrNetworkError(err)) {
        throw new AuthError(503, 'AUTH_UNAVAILABLE', 'Serviço de autenticação temporariamente indisponível. Tente novamente.')
      }
      throw err
    }

    if (userResponse.status === 401 || userResponse.status === 403) {
      throw new AuthError(401, 'AUTH_INVALID', 'Token de acesso inválido ou expirado.')
    }

    if (!userResponse.ok) {
      throw new AuthError(503, 'AUTH_UNAVAILABLE', 'Serviço de autenticação temporariamente indisponível. Tente novamente.')
    }

    let userData: unknown
    try {
      userData = await userResponse.json()
    } catch {
      throw new AuthError(401, 'AUTH_INVALID', 'Resposta inesperada do serviço de autenticação.')
    }

    if (!userData || typeof userData !== 'object' || !('id' in userData) || typeof userData.id !== 'string' || !UUID_REGEX.test(userData.id)) {
      throw new AuthError(401, 'AUTH_INVALID', 'Token de acesso não contém identificador de usuário válido.')
    }

    const userId = userData.id

    let profileResponse: Response
    try {
      profileResponse = await fetcher(
        `${config.supabaseUrl}/rest/v1/profiles?select=id,nome,cargo&id=eq.${encodeURIComponent(userId)}&limit=1`,
        {
          method: 'GET',
          headers: {
            apikey: config.supabaseAnonKey,
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          'User-Agent': 'MCK-FNS/1.0',
          },
          signal: AbortSignal.timeout(8000),
          redirect: 'manual',
        },
      )
    } catch (err) {
      if (isTimeoutOrNetworkError(err)) {
        throw new AuthError(503, 'AUTH_UNAVAILABLE', 'Serviço de autenticação temporariamente indisponível. Tente novamente.')
      }
      throw err
    }

    if (profileResponse.status === 401 || profileResponse.status === 403) {
      throw new AuthError(401, 'AUTH_INVALID', 'Token de acesso inválido ao carregar perfil.')
    }

    if (!profileResponse.ok) {
      throw new AuthError(503, 'AUTH_UNAVAILABLE', 'Não foi possível carregar o perfil de acesso.')
    }

    let profiles: unknown
    try {
      profiles = await profileResponse.json()
    } catch {
      throw new AuthError(503, 'AUTH_UNAVAILABLE', 'Resposta inválida ao consultar perfil.')
    }

    if (!Array.isArray(profiles) || profiles.length === 0) {
      throw new AuthError(403, 'GESTOR_ONLY', 'O FNS é restrito a gestores.')
    }

    const profile = profiles[0]
    if (!profile || typeof profile !== 'object' || !('cargo' in profile) || typeof profile.cargo !== 'string') {
      throw new AuthError(403, 'GESTOR_ONLY', 'O FNS é restrito a gestores.')
    }

    const cargo = profile.cargo.toLowerCase().trim()
    if (cargo !== 'gestor' && cargo !== 'admin') {
      throw new AuthError(403, 'GESTOR_ONLY', 'O FNS é restrito a gestores.')
    }

    const nome = 'nome' in profile && typeof profile.nome === 'string' ? profile.nome.trim() || null : null

    const resolvedUser: AuthUser = {
      id: userId,
      nome,
      cargo,
    }

    // Cache por até 60s, mas não além do exp do JWT
    const expMs = parseJwtExpMs(token)
    let ttl = CACHE_TTL_MS
    if (expMs !== null) {
      const remainingMs = expMs - now
      if (remainingMs <= 0) {
        throw new AuthError(401, 'AUTH_INVALID', 'Token de acesso expirado.')
      }
      ttl = Math.min(CACHE_TTL_MS, remainingMs)
    }

    if (identityCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = identityCache.keys().next().value
      if (oldestKey) identityCache.delete(oldestKey)
    }

    identityCache.set(hash, {
      expiresAt: now + ttl,
      user: resolvedUser,
    })

    return resolvedUser
  }

  const guard: MiddlewareHandler<AuthEnv> = async (context, next) => {
    if (config.authRequired !== true) {
      return next()
    }

    if (context.req.method === 'OPTIONS') {
      return next()
    }

    if (context.req.path === '/api/auth/config') {
      return next()
    }

    const header = context.req.header('Authorization') ?? ''
    const match = /^Bearer\s+([^\s]+)$/i.exec(header)
    if (!match) {
      return context.json(
        { error: { code: 'AUTH_REQUIRED', message: 'Sessão autenticada necessária.' } },
        401,
      )
    }

    const token = match[1]
    try {
      const user = await resolveIdentity(token)
      context.set('user', user)
      return next()
    } catch (err) {
      if (err instanceof AuthError) {
        return context.json(
          { error: { code: err.code, message: err.message } },
          err.status as any,
        )
      }
      logger.error('Erro inesperado na validação de autenticação')
      return context.json(
        { error: { code: 'AUTH_UNAVAILABLE', message: 'Serviço de autenticação temporariamente indisponível.' } },
        503,
      )
    }
  }

  const api = new Hono<AuthEnv>()

  api.get('/auth/config', (context) => {
    return context.json({
      authRequired: Boolean(config.authRequired),
      supabaseUrl: config.supabaseUrl ?? null,
      supabaseAnonKey: config.supabaseAnonKey ?? null,
      turnstileSiteKey: config.turnstileSiteKey ?? null,
    })
  })

  api.get('/auth/me', async (context) => {
    const existingUser = context.get('user')
    if (existingUser) {
      return context.json({ user: existingUser })
    }

    // Se authRequired não estiver ativo, mas foi enviado token, tenta resolver
    const header = context.req.header('Authorization') ?? ''
    const match = /^Bearer\s+([^\s]+)$/i.exec(header)
    if (match && config.supabaseUrl && config.supabaseAnonKey) {
      try {
        const user = await resolveIdentity(match[1])
        return context.json({ user })
      } catch {
        return context.json({ user: null })
      }
    }

    return context.json({ user: null })
  })

  return { guard, api, resolveIdentity }
}

