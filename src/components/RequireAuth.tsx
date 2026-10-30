import type { PropsWithChildren } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../services/authSession'
import Login from '../pages/Login'

export default function RequireAuth({ children }: PropsWithChildren) {
  const { status } = useAuth()

  if (status === 'loading') {
    return (
      <div className="login-root" role="status" aria-live="polite">
        <div style={{ textAlign: 'center', color: '#ffffff' }}>
          <Loader2 size={32} className="login-spinner" style={{ margin: '0 auto 12px' }} />
          <div style={{ fontSize: '13px', fontWeight: 600 }}>Verificando credenciais...</div>
        </div>
      </div>
    )
  }

  if (status === 'anonymous') {
    return <Login />
  }

  return <>{children}</>
}

