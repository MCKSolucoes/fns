import { Menu, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'

const titles: Record<string, string> = { '/': 'Dashboard', '/consultas': 'Consultas FNS', '/repasses-importados': 'Repasses importados', '/migracao-dados': 'Migração de dados', '/emendas-estaduais': 'Emendas Estaduais', '/deputados': 'Deputados', '/baixas': 'Controle de Baixas', '/comparacao-parcelas': 'Comparação mensal', '/historico': 'Histórico' }

export default function Header({ open, onToggle }: { open: boolean; onToggle: () => void }) {
	const location = useLocation()
	const title = location.pathname.startsWith('/baixas/') ? 'Registro de baixa' : titles[location.pathname] ?? 'Dashboard'
	return <header className="topbar"><button className="mobile-menu" aria-label={open ? 'Fechar menu' : 'Abrir menu'} onClick={onToggle}>{open ? <X size={19} /> : <Menu size={19} />}</button><div><div className="crumbs">FNS Gestão <span aria-hidden="true">/</span> {title}</div><h1 className="page-title">{title}</h1></div><div className="user-menu"><div className="avatar">MCK</div><div className="user-copy"><div className="user-name">MCK-FNS</div><div className="user-role">Autenticação futura</div></div></div></header>
}
