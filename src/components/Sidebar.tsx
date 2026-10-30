import { Database, LayoutDashboard, Search } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import logoBranca from '../../logobranca.png'

const links = [
	{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
	{ to: '/consultas', label: 'Consultas FNS', icon: Search },
	{ to: '/repasses-importados', label: 'Repasses importados', icon: Database },
]

export default function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
	return <>
		<button className={`mobile-overlay ${open ? 'open' : ''}`} aria-label="Fechar navegação" onClick={onNavigate} />
		<aside className={`sidebar ${open ? 'open' : ''}`}>
			<div className="brand"><img src={logoBranca} alt="MCK Soluções em Saúde Pública" className="brand-logo object-contain" /></div>
			<div className="nav-label">Gestão financeira</div>
			<nav className="nav-list" aria-label="Navegação principal">{links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onNavigate}><Icon size={17} strokeWidth={1.8} />{label}</NavLink>)}</nav>
			<div className="sidebar-bottom"><div className="demo-notice"><strong>Dados oficiais e internos separados</strong>As consultas usam a fonte oficial do FNS; somente os registros selecionados são importados para o Supabase.</div></div>
		</aside>
	</>
}
