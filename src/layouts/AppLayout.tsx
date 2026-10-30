import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Header from '../components/Header'
import Sidebar from '../components/Sidebar'
import { useAppData } from '../hooks/useAppData'

export default function AppLayout() {
	const { dataLoading, dataError, persistenceMode, reload } = useAppData()
	const [menuOpen, setMenuOpen] = useState(false)
	const { pathname } = useLocation()
	const showAuxiliaryDataStatus = pathname !== '/consultas' && pathname !== '/repasses-importados'
	const showAuxiliaryDataError = showAuxiliaryDataStatus && pathname !== '/'
	return <div className="app-shell"><Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} /><main className="app-main"><Header open={menuOpen} onToggle={() => setMenuOpen((current) => !current)} />{showAuxiliaryDataStatus && dataLoading && <div className="notice" role="status">Carregando dados do Supabase…</div>}{showAuxiliaryDataError && dataError && <div className="notice notice-error" role="alert">{dataError}{persistenceMode === 'supabase' && <> <button className="text-action" onClick={() => void reload().catch(() => {})}>Tentar novamente</button></>}</div>}<Outlet /></main></div>
}
