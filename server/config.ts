export interface ServerConfig {
  host: string
  port: number
  frontendOrigin: string
  fnsTimeoutMs: number
  supabaseUrl?: string
  supabaseAnonKey?: string
  supabaseServiceRoleKey?: string
  supabaseTestMode?: boolean
  authRequired?: boolean
  turnstileSiteKey?: string
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} deve ser um inteiro positivo.`)
  return parsed
}

function getOrigin(value: string | undefined): string {
  const origin = value ?? 'http://127.0.0.1:5173'
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new Error('FRONTEND_ORIGIN deve ser uma origem HTTP(S) válida.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin.replace(/\/$/, '')) {
    throw new Error('FRONTEND_ORIGIN deve conter somente a origem, sem caminho ou credenciais.')
  }
  return url.origin
}

function getSupabaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('SUPABASE_URL deve ser uma URL válida.')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') {
    throw new Error('SUPABASE_URL deve conter somente a origem HTTPS do projeto.')
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('SUPABASE_URL deve usar HTTPS fora do ambiente local.')
  }
  return url.origin
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const fnsTimeoutMs = positiveInteger(env.FNS_TIMEOUT_MS, 10_000, 'FNS_TIMEOUT_MS')
  if (fnsTimeoutMs > 60_000) throw new Error('FNS_TIMEOUT_MS não pode exceder 60000.')
  const supabaseUrl = getSupabaseUrl(env.SUPABASE_URL)
  const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim() || undefined
  const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined
  const supabaseTestMode = env.SUPABASE_TEST_MODE === 'true'
  const authRequired = !supabaseTestMode
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY?.trim() || '0x4AAAAAADvjK71xxwbhyLy2'
  if (Boolean(supabaseUrl) !== Boolean(supabaseAnonKey)) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_ANON_KEY juntos.')
  }
  if (supabaseTestMode) {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('O modo de teste Supabase exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
    }
    if (!['127.0.0.1', 'localhost', '::1'].includes(env.HOST || '127.0.0.1')) {
      throw new Error('O modo de teste Supabase só pode ser executado em um host local.')
    }
    const frontendHost = new URL(getOrigin(env.FRONTEND_ORIGIN)).hostname
    if (!['127.0.0.1', 'localhost', '::1'].includes(frontendHost)) {
      throw new Error('O modo de teste Supabase só pode aceitar uma origem local.')
    }
  }

  return {
    host: env.HOST || '127.0.0.1',
    port: positiveInteger(env.PORT, 3001, 'PORT'),
    frontendOrigin: getOrigin(env.FRONTEND_ORIGIN),
    fnsTimeoutMs,
    ...(supabaseUrl && supabaseAnonKey ? { supabaseUrl, supabaseAnonKey } : {}),
    ...(supabaseServiceRoleKey ? { supabaseServiceRoleKey } : {}),
    supabaseTestMode,
    authRequired,
    turnstileSiteKey,
  }
}