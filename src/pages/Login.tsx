import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { AlertCircle, Eye, EyeOff, Loader2, Lock, ShieldCheck, User } from 'lucide-react'
import { useAuth } from '../services/authSession'
import logoBranca from '../../logobranca.png'

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string
          theme?: 'light' | 'dark' | 'auto'
          callback?: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
        },
      ) => string
      reset: (widgetId?: string) => void
      remove: (widgetId?: string) => void
    }
  }
}

export default function Login() {
  const { login, notice, clearNotice, turnstileSiteKey } = useAuth()
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  const turnstileContainerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)

  const effectiveSiteKey = turnstileSiteKey || '0x4AAAAAADvjK71xxwbhyLy2'

  // Carrega e renderiza o Turnstile da Cloudflare
  useEffect(() => {
    let cancelled = false

    function renderWidget() {
      if (cancelled || !turnstileContainerRef.current) return
      if (!window.turnstile) return
      if (widgetIdRef.current) return

      try {
        widgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
          sitekey: effectiveSiteKey,
          theme: 'light',
          callback: (token: string) => {
            if (!cancelled) {
              setCaptchaToken(token)
              setError(null)
            }
          },
          'expired-callback': () => {
            if (!cancelled) setCaptchaToken(null)
          },
          'error-callback': () => {
            if (!cancelled) setCaptchaToken(null)
          },
        })
      } catch (e) {
        console.warn('[FNS Turnstile] Falha ao renderizar widget:', e)
      }
    }

    if (window.turnstile) {
      renderWidget()
    } else {
      // Script carregado assincronamente pelo index.html ou injetado dinamicamente
      const timer = setInterval(() => {
        if (window.turnstile) {
          clearInterval(timer)
          renderWidget()
        }
      }, 100)

      const existingScript = document.querySelector('script[src*="turnstile"]')
      if (!existingScript) {
        const script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.async = true
        script.defer = true
        script.onload = () => {
          renderWidget()
        }
        document.head.appendChild(script)
      }

      return () => {
        cancelled = true
        clearInterval(timer)
      }
    }

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // ignore
        }
        widgetIdRef.current = null
      }
    }
  }, [effectiveSiteKey])

  const handleKeyModifier = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.getModifierState) {
      setCapsLock(e.getModifierState('CapsLock'))
    }
  }

  const resetTurnstile = () => {
    setCaptchaToken(null)
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current)
      } catch {
        // ignore
      }
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    clearNotice()
    setError(null)

    const cleanedUser = usuario.trim()
    if (!cleanedUser) {
      setError('Informe seu usuário ou CPF.')
      return
    }

    if (!password) {
      setError('Informe sua senha de acesso.')
      return
    }

    if (!captchaToken) {
      setError('Complete a verificação de segurança (Turnstile) antes de continuar.')
      return
    }

    setLoading(true)

    try {
      await login(cleanedUser, password, captchaToken)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao realizar login.')
      resetTurnstile()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-root">
      <div className="login-backdrop" aria-hidden="true" />

      <main className="login-container">
        <div className="login-card">
          <header className="login-header">
            <div className="login-brand-wrapper">
              <img
                src={logoBranca}
                alt="MCK Soluções em Saúde Pública"
                className="login-brand-logo"
              />
            </div>
            <h1 className="login-title">FNS Gestão</h1>
            <p className="login-subtitle">
              Portal Financeiro • Exclusivo para Gestores
            </p>
          </header>

          {(error || notice) && (
            <div
              className={`login-alert ${error ? 'login-alert-error' : 'login-alert-info'}`}
              role="alert"
            >
              <AlertCircle size={18} className="login-alert-icon" />
              <div className="login-alert-text">{error || notice}</div>
            </div>
          )}

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="login-field-group">
              <label htmlFor="login-usuario" className="login-label">
                Usuário / CPF
              </label>
              <div className="login-input-wrapper">
                <User size={18} className="login-input-icon" />
                <input
                  id="login-usuario"
                  type="text"
                  name="username"
                  className="login-input"
                  placeholder="Seu usuário no MCK"
                  value={usuario}
                  onChange={(e) => {
                    setUsuario(e.target.value)
                    if (error) setError(null)
                  }}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  disabled={loading}
                  autoFocus
                />
              </div>
            </div>

            <div className="login-field-group">
              <div className="login-label-row">
                <label htmlFor="login-password" className="login-label">
                  Senha
                </label>
                {capsLock && (
                  <span className="login-caps-warning">
                    Caps Lock ativado
                  </span>
                )}
              </div>
              <div className="login-input-wrapper">
                <Lock size={18} className="login-input-icon" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  className="login-input"
                  placeholder="Sua senha de acesso"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (error) setError(null)
                  }}
                  onKeyDown={handleKeyModifier}
                  onKeyUp={handleKeyModifier}
                  onBlur={() => setCapsLock(false)}
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="login-toggle-password"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="login-turnstile-wrapper">
              <div
                id="turnstile-container-fns"
                ref={turnstileContainerRef}
                className="login-turnstile-container"
              />
            </div>

            <button
              type="submit"
              className="login-submit-button"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="login-spinner" />
                  <span>Autenticando...</span>
                </>
              ) : (
                <span>Acessar Painel FNS</span>
              )}
            </button>
          </form>

          <footer className="login-footer">
            <ShieldCheck size={14} className="login-footer-icon" />
            <span>Acesso integrado à plataforma MCK Soluções</span>
          </footer>
        </div>
      </main>
    </div>
  )
}
