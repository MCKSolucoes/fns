import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import {
  decodeJwtExp,
  fetchMe,
  initialSsoHandoff,
  loadAuthConfig,
  passwordLogin,
  refreshSession,
  DEFAULT_SUPABASE_URL,
  DEFAULT_SUPABASE_ANON_KEY,
  DEFAULT_TURNSTILE_SITE_KEY,
  type AuthConfig,
  type CurrentUser,
  AUTH_STORAGE_KEY,
} from './authClient'

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated'

export interface AuthContextValue {
  status: AuthStatus
  user: CurrentUser | null
  accessToken: string
  authRequired: boolean
  notice: string | null
  login: (usuario: string, pass: string, captchaToken?: string) => Promise<void>
  logout: (reason?: string) => void
  clearNotice: () => void
  turnstileSiteKey: string
}

interface StoredSession {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  mode: 'sso' | 'password'
}

const STORAGE_KEY = AUTH_STORAGE_KEY
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [accessToken, setAccessToken] = useState('')
  const [authRequired, setAuthRequired] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string>(DEFAULT_TURNSTILE_SITE_KEY)

  const configRef = useRef<AuthConfig>({
    authRequired: true,
    supabaseUrl: DEFAULT_SUPABASE_URL,
    supabaseAnonKey: DEFAULT_SUPABASE_ANON_KEY,
    turnstileSiteKey: DEFAULT_TURNSTILE_SITE_KEY,
  })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleNextActionRef = useRef<((session: StoredSession, cfg: AuthConfig) => void) | null>(null)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const logout = useCallback((reason?: string) => {
    clearTimer()
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignorar erro em sessionStorage bloqueado
    }
    setAccessToken('')
    setUser(null)
    setStatus('anonymous')
    if (reason) {
      setNotice(reason)
    }
  }, [])

  const clearNotice = useCallback(() => {
    setNotice(null)
  }, [])

  const scheduleNextAction = useCallback((session: StoredSession, cfg: AuthConfig) => {
    clearTimer()
    const now = Date.now()
    const expiresAtMs = session.expiresAt * 1000

    if (session.mode === 'password' && session.refreshToken && cfg.supabaseUrl && cfg.supabaseAnonKey) {
      // Renovar 60s antes de expirar
      const refreshAtMs = expiresAtMs - 60_000
      const delay = Math.max(5_000, refreshAtMs - now)

      timerRef.current = setTimeout(async () => {
        try {
          const res = await refreshSession(cfg.supabaseUrl, cfg.supabaseAnonKey, session.refreshToken!)
          const updatedSession: StoredSession = {
            accessToken: res.accessToken,
            refreshToken: res.refreshToken,
            expiresAt: res.expiresAt,
            mode: 'password',
          }
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSession))
          setAccessToken(res.accessToken)
          scheduleNextActionRef.current?.(updatedSession, cfg)
        } catch {
          logout('Sua sessão expirou. Faça login novamente.')
        }
      }, delay)
    } else if (session.mode === 'sso') {
      // Sessão SSO: não tem refresh token (evita rotação conflitante com o MCK)
      const delay = Math.max(0, expiresAtMs - now)
      timerRef.current = setTimeout(() => {
        logout('Sessão do MCK expirou — reabra o FNS pelo MCK ou entre com usuário e senha.')
      }, delay)
    }
  }, [logout])

  useEffect(() => {
    scheduleNextActionRef.current = scheduleNextAction
  }, [scheduleNextAction])

  useEffect(() => {
    let active = true

    async function init() {
      let cfg: AuthConfig
      try {
        cfg = await loadAuthConfig()
      } catch {
        cfg = {
          authRequired: true,
          supabaseUrl: DEFAULT_SUPABASE_URL,
          supabaseAnonKey: DEFAULT_SUPABASE_ANON_KEY,
          turnstileSiteKey: DEFAULT_TURNSTILE_SITE_KEY,
        }
      }

      if (!active) return
      configRef.current = cfg
      setTurnstileSiteKey(cfg.turnstileSiteKey)

      if (!cfg.authRequired) {
        setAuthRequired(false)
        setUser({ id: 'local-test', nome: 'Desenvolvimento Local', cargo: 'gestor' })
        setAccessToken('')
        setStatus('authenticated')
        return
      }

      setAuthRequired(true)

      // 1. Tenta handoff SSO capturado na inicialização da página
      if (initialSsoHandoff?.accessToken) {
        try {
          const validatedUser = await fetchMe(initialSsoHandoff.accessToken, cfg.supabaseUrl, cfg.supabaseAnonKey)
          if (!active) return

          const expFromJwt = decodeJwtExp(initialSsoHandoff.accessToken)
          const expiresAt = initialSsoHandoff.expiresAt
            ?? expFromJwt
            ?? (Math.floor(Date.now() / 1000) + 3600)

          const ssoSession: StoredSession = {
            accessToken: initialSsoHandoff.accessToken,
            expiresAt,
            mode: 'sso',
          }
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ssoSession))
          setAccessToken(initialSsoHandoff.accessToken)
          setUser(validatedUser)
          setStatus('authenticated')
          setNotice(null)
          scheduleNextAction(ssoSession, cfg)
          return
        } catch (err) {
          if (!active) return
          sessionStorage.removeItem(STORAGE_KEY)
          setNotice(err instanceof Error ? err.message : 'Sessão do MCK inválida ou não autorizada.')
          setStatus('anonymous')
          return
        }
      }

      // 2. Tenta recuperar sessão persistida do sessionStorage
      let stored: StoredSession | null = null
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY)
        if (raw) stored = JSON.parse(raw) as StoredSession
      } catch {
        stored = null
      }

      if (stored?.accessToken && stored.expiresAt) {
        const isExpired = stored.expiresAt * 1000 <= Date.now()

        if (!isExpired) {
          try {
            const validatedUser = await fetchMe(stored.accessToken, cfg.supabaseUrl, cfg.supabaseAnonKey)
            if (!active) return
            setAccessToken(stored.accessToken)
            setUser(validatedUser)
            setStatus('authenticated')
            setNotice(null)
            scheduleNextAction(stored, cfg)
            return
          } catch (err) {
            if (!active) return
            // Se falhou e tem refresh_token, tenta renovar abaixo
            if (!(stored.mode === 'password' && stored.refreshToken && cfg.supabaseUrl && cfg.supabaseAnonKey)) {
              sessionStorage.removeItem(STORAGE_KEY)
              setNotice(err instanceof Error ? err.message : 'Sessão expirada.')
              setStatus('anonymous')
              return
            }
          }
        }

        // Tentar renovação se for modo password
        if (stored.mode === 'password' && stored.refreshToken && cfg.supabaseUrl && cfg.supabaseAnonKey) {
          try {
            const res = await refreshSession(cfg.supabaseUrl, cfg.supabaseAnonKey, stored.refreshToken)
            const validatedUser = await fetchMe(res.accessToken, cfg.supabaseUrl, cfg.supabaseAnonKey)
            if (!active) return
            const renewedSession: StoredSession = {
              accessToken: res.accessToken,
              refreshToken: res.refreshToken,
              expiresAt: res.expiresAt,
              mode: 'password',
            }
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(renewedSession))
            setAccessToken(res.accessToken)
            setUser(validatedUser)
            setStatus('authenticated')
            setNotice(null)
            scheduleNextAction(renewedSession, cfg)
            return
          } catch {
            if (!active) return
            sessionStorage.removeItem(STORAGE_KEY)
            setNotice('Sua sessão expirou. Faça login novamente.')
            setStatus('anonymous')
            return
          }
        } else {
          sessionStorage.removeItem(STORAGE_KEY)
          setNotice('Sessão do MCK expirou — reabra o FNS pelo MCK ou entre com usuário e senha.')
          setStatus('anonymous')
          return
        }
      }

      if (active) {
        setStatus('anonymous')
      }
    }

    void init()

    return () => {
      active = false
      clearTimer()
    }
  }, [scheduleNextAction])

  const login = useCallback(async (usuario: string, pass: string, captchaToken?: string) => {
    const cfg = configRef.current
    const res = await passwordLogin(cfg.supabaseUrl, cfg.supabaseAnonKey, usuario, pass, captchaToken)
    const validatedUser = await fetchMe(res.accessToken, cfg.supabaseUrl, cfg.supabaseAnonKey)

    const session: StoredSession = {
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      expiresAt: res.expiresAt,
      mode: 'password',
    }

    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    } catch {
      // ignorar falha se storage inacessível
    }

    setAccessToken(res.accessToken)
    setUser(validatedUser)
    setStatus('authenticated')
    setNotice(null)
    scheduleNextAction(session, cfg)
  }, [scheduleNextAction])

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        accessToken,
        authRequired,
        notice,
        login,
        logout,
        clearNotice,
        turnstileSiteKey,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider')
  }
  return context
}
