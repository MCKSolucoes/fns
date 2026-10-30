export interface SsoHandoff {
  accessToken: string
  expiresAt: number | null
}

export interface AuthConfig {
  authRequired: boolean
  supabaseUrl: string
  supabaseAnonKey: string
  turnstileSiteKey: string
}

export interface CurrentUser {
  id: string
  nome: string | null
  cargo: string
}

export interface LoginResult {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export const DEFAULT_SUPABASE_URL = 'https://kgbkprnobqyejhpgyxfr.supabase.co'
export const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_MLvYds-NkDS0Js2C4xvzJg_FEN3ITH0'
export const DEFAULT_TURNSTILE_SITE_KEY = '0x4AAAAAADvjK71xxwbhyLy2'

function parseAndClearSsoHash(): SsoHandoff | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  if (!hash || !hash.includes('access_token=')) return null

  const queryPart = hash.slice(hash.indexOf('access_token='))
  const params = new URLSearchParams(queryPart)
  const accessToken = params.get('access_token')
  if (!accessToken) return null

  const expiresAtStr = params.get('expires_at')
  const expiresAt = expiresAtStr ? Number(expiresAtStr) : null

  // Armadilha do StrictMode: ler e limpar o hash no escopo do módulo
  try {
    const cleanUrl = window.location.pathname + window.location.search
    window.history.replaceState(null, '', cleanUrl)
  } catch {
    // ignorar falha em ambiente sem history
  }

  return {
    accessToken,
    expiresAt: expiresAt && Number.isFinite(expiresAt) ? expiresAt : null,
  }
}

/**
 * Capturado uma única vez na inicialização do módulo, imune ao duplo mount do StrictMode.
 */
export const initialSsoHandoff: SsoHandoff | null = parseAndClearSsoHash()

export function normalizeUsuario(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (trimmed.endsWith('@sistema.mck')) {
    const userPart = trimmed.slice(0, -'@sistema.mck'.length).replace(/[.-]/g, '')
    return `${userPart}@sistema.mck`
  }
  const cleaned = trimmed.replace(/[.-]/g, '')
  return `${cleaned}@sistema.mck`
}

export function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const decoded = atob(payloadBase64)
    const parsed = JSON.parse(decoded)
    if (typeof parsed.exp === 'number') {
      return parsed.exp
    }
  } catch {
    // ignorar erro de parsing
  }
  return null
}

export async function loadAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch('/api/auth/config', {
      headers: { Accept: 'application/json' },
    })
    if (res.ok) {
      const data = await res.json()
      return {
        authRequired: data.authRequired ?? true,
        supabaseUrl: data.supabaseUrl || DEFAULT_SUPABASE_URL,
        supabaseAnonKey: data.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY,
        turnstileSiteKey: data.turnstileSiteKey || DEFAULT_TURNSTILE_SITE_KEY,
      }
    }
  } catch {
    // Backend indisponível / não iniciado localmente; fallback automático
  }

  const envUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) as string | undefined
  const envKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) as string | undefined
  const envTurnstile = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TURNSTILE_SITE_KEY) as string | undefined

  return {
    authRequired: true,
    supabaseUrl: envUrl || DEFAULT_SUPABASE_URL,
    supabaseAnonKey: envKey || DEFAULT_SUPABASE_ANON_KEY,
    turnstileSiteKey: envTurnstile || DEFAULT_TURNSTILE_SITE_KEY,
  }
}

export async function passwordLogin(
  supabaseUrl: string,
  supabaseAnonKey: string,
  usuario: string,
  password: string,
  captchaToken?: string,
): Promise<LoginResult> {
  const email = normalizeUsuario(usuario)
  const body: Record<string, unknown> = {
    email,
    password,
  }
  if (captchaToken) {
    body.gotrue_meta_security = { captcha_token: captchaToken }
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  let data: any
  try {
    data = await res.json()
  } catch {
    throw new Error('Resposta inválida do serviço de login.')
  }

  if (!res.ok) {
    const errorMsg = data?.error_description || data?.msg || data?.message || ''
    if (errorMsg.includes('Invalid login credentials')) {
      throw new Error('Usuário ou senha incorretos.')
    }
    if (errorMsg.includes('captcha')) {
      throw new Error('Falha na verificação de segurança (Turnstile). Tente novamente.')
    }
    throw new Error(errorMsg || 'Falha de autenticação.')
  }

  const accessToken = data.access_token
  const refreshToken = data.refresh_token
  let expiresAt = data.expires_at
  if (!expiresAt) {
    const expFromJwt = decodeJwtExp(accessToken)
    expiresAt = expFromJwt ?? Math.floor(Date.now() / 1000) + (data.expires_in || 3600)
  }

  return { accessToken, refreshToken, expiresAt }
}

export async function refreshSession(
  supabaseUrl: string,
  supabaseAnonKey: string,
  refreshToken: string,
): Promise<LoginResult> {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })

  let data: any
  try {
    data = await res.json()
  } catch {
    throw new Error('Falha ao renovar sessão.')
  }

  if (!res.ok) {
    throw new Error('Sessão expirada. Faça login novamente.')
  }

  const accessToken = data.access_token
  const newRefreshToken = data.refresh_token || refreshToken
  let expiresAt = data.expires_at
  if (!expiresAt) {
    const expFromJwt = decodeJwtExp(accessToken)
    expiresAt = expFromJwt ?? Math.floor(Date.now() / 1000) + (data.expires_in || 3600)
  }

  return { accessToken, refreshToken: newRefreshToken, expiresAt }
}

export async function fetchMe(
  token: string,
  supabaseUrl = DEFAULT_SUPABASE_URL,
  supabaseAnonKey = DEFAULT_SUPABASE_ANON_KEY,
): Promise<CurrentUser> {
  // 1. Tenta consultar via backend caso esteja em execução
  try {
    const res = await fetch('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })

    if (res.status === 200) {
      const data = await res.json()
      if (data?.user) return data.user
    } else if (res.status === 403) {
      throw new Error('O FNS é restrito a gestores e administradores.')
    } else if (res.status === 401) {
      throw new Error('Sessão inválida ou expirada.')
    }
  } catch (err) {
    if (err instanceof Error && (err.message.includes('restrito') || err.message.includes('Sessão'))) {
      throw err
    }
    // Caso de backend indisponível (502 Bad Gateway / ECONNREFUSED): valida diretamente no Supabase
  }

  // 2. Validação direta no Supabase (mesma regra da plataforma MCK)
  let userRes: Response
  try {
    userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
  } catch {
    throw new Error('Não foi possível conectar ao serviço de autenticação.')
  }

  if (userRes.status === 401 || userRes.status === 403) {
    throw new Error('Sessão inválida ou expirada.')
  }

  if (!userRes.ok) {
    throw new Error('Falha ao validar sessão com o provedor de autenticação.')
  }

  const userData = await userRes.json()
  const userId = userData?.id
  if (!userId) {
    throw new Error('Identificador de usuário não encontrado.')
  }

  // Busca perfil para validar se é gestor ou admin
  let profileRes: Response
  try {
    profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?select=id,nome,cargo&id=eq.${encodeURIComponent(userId)}&limit=1`,
      {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    )
  } catch {
    throw new Error('Não foi possível conectar para verificar permissões.')
  }

  if (!profileRes.ok) {
    throw new Error('Não foi possível carregar o perfil de acesso.')
  }

  const profiles = await profileRes.json()
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error('Perfil de usuário não encontrado.')
  }

  const profile = profiles[0]
  const cargo = String(profile?.cargo || '').toLowerCase().trim()
  if (cargo !== 'gestor' && cargo !== 'admin') {
    throw new Error('O FNS é restrito a gestores e administradores.')
  }

  return {
    id: userId,
    nome: typeof profile.nome === 'string' ? profile.nome.trim() || null : null,
    cargo,
  }
}

export const AUTH_STORAGE_KEY = 'fns-auth:v1'

export function getStoredAccessToken(): string | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null
  try {
    const raw = window.sessionStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return typeof parsed?.accessToken === 'string' && parsed.accessToken ? parsed.accessToken : null
  } catch {
    return null
  }
}

