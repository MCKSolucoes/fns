import { useMemo, useState } from 'react'
import { Database, RefreshCw } from 'lucide-react'
import { useBackendSession } from '../services/backendSession'
import { inspectLocalData, migrateLocalData, type LocalDataMigrationResult, type MigrationCategory } from '../services/localDataMigration'

const categoryLabels: Array<{ key: MigrationCategory; label: string }> = [
	{ key: 'amendments', label: 'Emendas estaduais' },
	{ key: 'baixas', label: 'Baixas locais' },
	{ key: 'history', label: 'Histórico de baixas' },
	{ key: 'complements', label: 'Complementos financeiros' },
	{ key: 'launches', label: 'Rascunhos de lançamentos financeiros' },
	{ key: 'reviews', label: 'Análises e justificativas mensais' },
]

export default function MigracaoDados() {
	const { accessToken, hasSharedAccess, sharedStorageError } = useBackendSession()
	const [snapshot, setSnapshot] = useState(() => inspectLocalData())
	const [selected, setSelected] = useState<Set<MigrationCategory>>(() => new Set(categoryLabels.map(({ key }) => key)))
	const [running, setRunning] = useState(false)
	const [error, setError] = useState('')
	const [result, setResult] = useState<LocalDataMigrationResult | null>(null)
	const totalAvailable = useMemo(() => Object.values(snapshot.categories).reduce((sum, count) => sum + count, 0), [snapshot.categories])

	const run = async () => {
		if (!hasSharedAccess) {
			setError(sharedStorageError || 'A persistência Supabase não está habilitada. Nenhum dado foi enviado.')
			return
		}
		if (selected.size === 0 || !window.confirm('Migrar os grupos selecionados para o Supabase? A origem local não será apagada; operações parciais podem ser repetidas com segurança.')) return
		setRunning(true)
		setError('')
		setResult(null)
		try {
			const next = await migrateLocalData(accessToken, [...selected])
			setResult(next)
			setSnapshot(inspectLocalData())
		} catch (migrationError) {
			setError(migrationError instanceof Error ? migrationError.message : 'A migração não foi concluída.')
		} finally {
			setRunning(false)
		}
	}

	return <div className="page-content">
		<div className="page-heading"><div><h2>Migração de dados locais</h2><p>Pré-visualize os registros e migre explicitamente dados legados para o banco compartilhado.</p></div><button className="button" type="button" disabled={running} onClick={() => { setSnapshot(inspectLocalData()); setResult(null); setError('') }}><RefreshCw size={14} /> Reexaminar localStorage</button></div>
		<div className="notice notice-amber"><Database size={15} /> A migração é não destrutiva e idempotente: os dados locais não serão removidos.</div>
		{!hasSharedAccess && <div className="notice notice-amber">{sharedStorageError || 'Configure SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY e SUPABASE_TEST_MODE=true no backend local para habilitar a migração.'}</div>}
		{snapshot.skippedDemoBaixas > 0 && <div className="notice notice-blue">{snapshot.skippedDemoBaixas} baixa(s) iniciais demonstrativas e {snapshot.skippedDemoHistory} evento(s) de histórico inicial foram excluídos da migração automática. Registros locais alterados permanecem elegíveis e serão importados somente como dados internos, nunca como repasses oficiais.</div>}
		{snapshot.errors.map((item, index) => <div key={`${index}-${item}`} className="notice notice-error" role="alert">{item}</div>)}
		{error && <div className="notice notice-error" role="alert">{error}</div>}
		{result && <section className={result.errors.length ? 'notice notice-amber' : 'notice'} role="status">
			<strong>Migração concluída com {result.errors.length} ocorrência(s).</strong>
			<ul>{categoryLabels.map(({ key, label }) => <li key={key}>{label}: {result.migrated[key]} processado(s)/confirmado(s).</li>)}</ul>
			{result.errors.map((item, index) => <div key={`${index}-${item}`} role="alert">{item}</div>)}
			<p>Os registros locais permanecem no navegador. Repetir a operação é seguro e não duplica os registros identificados por chave legada.</p>
		</section>}
		<section className="table-panel">
			<div className="table-toolbar"><strong>Dados encontrados</strong><span>{totalAvailable} registro(s) elegível(is)</span></div>
			<div className="filter-grid" style={{ padding: 18 }}>
				{categoryLabels.map(({ key, label }) => <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
					<input type="checkbox" checked={selected.has(key)} disabled={snapshot.categories[key] === 0 || running} onChange={(event) => setSelected((current) => {
						const next = new Set(current)
						if (event.target.checked) next.add(key)
						else next.delete(key)
						return next
					})} />
					<span>{label} · {snapshot.categories[key]}</span>
				</label>)}
			</div>
			<div className="form-footer"><button className="button button-primary" type="button" onClick={() => void run()} disabled={running || !hasSharedAccess || selected.size === 0 || totalAvailable === 0}>{running ? 'Migrando e verificando…' : 'Migrar grupos selecionados'}</button></div>
		</section>
		<div className="notice">A migração mantém snapshots dos vínculos locais. Itens sem formato válido são informados e permanecem intactos para conferência; a operação pode ser repetida após correção.</div>
	</div>
}
