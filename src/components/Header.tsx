import { LogOut, Menu, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../services/authSession'

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/consultas': 'Consultas FNS',
  '/repasses-importados': 'Repasses importados',
  '/migracao-dados': 'Migração de dados',
  '/emendas-estaduais': 'Emendas Estaduais',
  '/deputados': 'Deputados',
  '/baixas': 'Controle de Baixas',
  '/comparacao-parcelas': 'Comparação mensal',
  '/historico': 'Histórico',
}

function getInitials(name?: string | null): string {
  if (!name) return 'MC'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function Header({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const location = useLocation()
  const { user, logout, authRequired } = useAuth()
  const title = location.pathname.startsWith('/baixas/')
    ? 'Registro de baixa'
    : titles[location.pathname] ?? 'Dashboard'

  const displayName = !authRequired
    ? 'Modo de teste local'
    : (user?.nome || 'Gestor MCK')

  const displayRole = !authRequired
    ? 'Ambiente de Testes'
    : (user?.cargo === 'admin' ? 'Administrador' : 'Gestor')

  const initials = !authRequired ? 'TL' : getInitials(user?.nome)

  return (
    <header className="topbar">
      <button
        className="mobile-menu"
        aria-label={open ? 'Fechar menu' : 'Abrir menu'}
        onClick={onToggle}
      >
        {open ? <X size={19} /> : <Menu size={19} />}
      </button>

      <div>
        <div className="crumbs">
          FNS Gestão <span aria-hidden="true">/</span> {title}
        </div>
        <h1 className="page-title">{title}</h1>
      </div>

      <div className="user-menu">
        <div className="avatar">{initials}</div>
        <div className="user-copy">
          <div className="user-name">{displayName}</div>
          <div className="user-role">{displayRole}</div>
        </div>
        {authRequired && (
          <button
            type="button"
            className="user-logout-button"
            onClick={() => logout()}
            title="Sair do FNS"
            aria-label="Sair do FNS"
          >
            <LogOut size={14} />
            <span>Sair</span>
          </button>
        )}
      </div>
    </header>
  )
}
