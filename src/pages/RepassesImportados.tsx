import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Eye, Pencil, RefreshCw, Save, X } from 'lucide-react'
import { backendRequest, BackendApiError } from '../services/backendApi'
import { useBackendSession } from '../services/backendSession'
import { useFeedback } from '../services/feedbackContext'
import type { ConsultationFilters } from '../types'
import type { FnsFinancialAction, FnsFinancialEntity, FnsFinancialLaunchDraft } from '../types/fnsFinancial'
import { createFnsFinancialActionKey } from '../utils/fnsFinancialActionKey'
import { formatFnsFinancialActionDetail, getFnsFinancialActionDetails } from '../utils/fnsFinancialActionDetails'
import { emptyFnsFinancialLaunchDraft, formatFnsFinancialLaunchAmount, getFnsFinancialLaunchDate, isValidFnsFinancialLaunchDate, parseFnsFinancialLaunchAmount } from '../utils/fnsFinancialLaunch'
import { formatCurrency, formatDate, formatDateTime } from '../utils/formatters'

interface StoredRepasse {
	id: string
	source_key: string
	reference_year: number
	reference_month: number | null
	municipality_uf: string | null
	municipality_name: string | null
	beneficiary_name: string | null
	beneficiary_cnpj: string | null
	transfer_identifier: string | null
	gross_amount: number | null
	discount_amount: number | null
	net_amount: number | null
	query_type?: string | null
	source_data: { record?: Record<string, unknown>; entity?: unknown; filters?: unknown }
	consulted_at: string
	imported_at: string
}

interface RepassePage {
	items: StoredRepasse[]
	total: number
	page: number
	pageSize: number
}

interface ImportHistory {
	id: string
	status: string
	records_found: number
	records_imported: number
	records_updated: number
	records_ignored: number
	started_at: string
	completed_at: string | null
}

interface StoredLaunch {
	action_key: string
	repasse_id: string | null
	status: string
	amount: number | string
	launch_date: string | null
	document_number: string
	account_reference: string
	responsible: string
	observations: string
	created_at: string
	updated_at: string
}

const PAGE_SIZE = 25
const emptyConsultationFilters: ConsultationFilters = {
	year: '', month: '', queryType: '', block: '', group: '', document: '', state: '', city: '', cityCode: '',
	processNumber: '', proposal: '', transferType: '', dateFrom: '', dateTo: '', portaria: '',
}

interface EditingLaunch {
	repasse: StoredRepasse
	action: FnsFinancialAction
	actionKey: string
	draft: FnsFinancialLaunchDraft
	originalDraft: FnsFinancialLaunchDraft
	saved: StoredLaunch | null
	loading: boolean
	saving: boolean
	error: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string {
	return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function launchContext(repasse: StoredRepasse) {
	const actionRecord = repasse.source_data.record
	const entityRecord = repasse.source_data.entity
	const storedFilters = repasse.source_data.filters
	if (!actionRecord || !isRecord(entityRecord) || !isRecord(storedFilters)) return null

	const entity: FnsFinancialEntity = {
		cpfCnpj: entityRecord.cpfCnpj,
		cpfCnpjFormatado: entityRecord.cpfCnpjFormatado,
		codigoMunicipioIBGE: entityRecord.codigoMunicipioIBGE,
		municipio: entityRecord.municipio,
		uf: entityRecord.uf,
		razaoSocial: entityRecord.razaoSocial,
	}
	const filters: ConsultationFilters = {
		...emptyConsultationFilters,
		year: stringValue(storedFilters.year),
		month: stringValue(storedFilters.month),
		queryType: stringValue(storedFilters.queryType),
		state: stringValue(storedFilters.uf),
		cityCode: stringValue(storedFilters.municipalityIbge),
		document: stringValue(storedFilters.document),
	}
	return { action: { ...actionRecord }, entity, filters }
}

function sameLaunchDraft(left: FnsFinancialLaunchDraft, right: FnsFinancialLaunchDraft) {
	return left.status === right.status && left.amount === right.amount && left.date === right.date
		&& left.documentNumber === right.documentNumber && left.accountReference === right.accountReference
		&& left.responsible === right.responsible && left.observations === right.observations
}

function launchDraftFromRow(launch: StoredLaunch): FnsFinancialLaunchDraft {
	return {
		status: launch.status as FnsFinancialLaunchDraft['status'],
		amount: typeof launch.amount === 'number'
			? formatFnsFinancialLaunchAmount(launch.amount)
			: launch.amount,
		date: launch.launch_date || '',
		documentNumber: launch.document_number,
		accountReference: launch.account_reference,
		responsible: launch.responsible,
		observations: launch.observations,
	}
}

function officialValue(value: unknown): string {
	if (value === null || value === undefined || value === '') return '—'
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
	return '—'
}

function formatDocument(value: string | null): string {
	if (!value) return '—'
	const digits = value.replace(/\D/g, '')
	if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
	if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
	return value
}

function FinancialDetail({ label, value, financial = false }: { label: string; value: unknown; financial?: boolean }) {
	return <div className="financial-action-detail-card"><strong>{label}</strong><span>{formatFnsFinancialActionDetail(value, financial)}</span></div>
}

function getImportStatusClass(status: string) {
	const normalizedStatus = status.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
	if (normalizedStatus === 'concluida' || normalizedStatus === 'concluido') return 'status-pago'
	if (normalizedStatus === 'falhou' || normalizedStatus === 'erro') return 'status-cancelado'
	return 'import-status-neutral'
}

export default function RepassesImportados() {
	const { accessToken, hasSharedAccess, sharedStorageLoading, sharedStorageError } = useBackendSession()
	const [repassePage, setRepassePage] = useState<RepassePage>({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE })
	const [imports, setImports] = useState<ImportHistory[]>([])
	const [launches, setLaunches] = useState<StoredLaunch[]>([])
	const [launchError, setLaunchError] = useState('')
	const [query, setQuery] = useState('')
	const [year, setYear] = useState('')
	const [month, setMonth] = useState('')
	const [uf, setUf] = useState('')
	const [page, setPage] = useState(1)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [selectedRepasse, setSelectedRepasse] = useState<StoredRepasse | null>(null)
	const [editingLaunch, setEditingLaunch] = useState<EditingLaunch | null>(null)
	const launchSaveInProgress = useRef(false)
	const { notify, requestConfirmation } = useFeedback()

	const load = useCallback(async () => {
		if (!hasSharedAccess) return
		setLoading(true)
		setError('')
		try {
			const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
			if (query.trim()) params.set('query', query.trim())
			if (/^\d{4}$/.test(year)) params.set('year', year)
			if (month) params.set('month', month)
			if (uf) params.set('uf', uf)
			const [repasseResult, importRows] = await Promise.all([
				backendRequest<RepassePage>(`/api/data/repasses?${params}`, accessToken),
				backendRequest<ImportHistory[]>('/api/data/imports', accessToken),
			])
			if (!repasseResult || !Array.isArray(repasseResult.items)
				|| !Number.isInteger(repasseResult.total)
				|| repasseResult.page !== page
				|| repasseResult.pageSize !== PAGE_SIZE
				|| !Array.isArray(importRows)) {
				throw new Error('O banco retornou dados em formato inválido.')
			}
			setRepassePage(repasseResult)
			setImports(importRows)
			try {
				const launchRows = await backendRequest<StoredLaunch[]>('/api/data/launches', accessToken)
				if (!Array.isArray(launchRows)
					|| !launchRows.every((item) => item && typeof item.action_key === 'string'
						&& (item.repasse_id === null || typeof item.repasse_id === 'string')
						&& typeof item.status === 'string'
						&& (typeof item.amount === 'number' || typeof item.amount === 'string')
						&& (item.launch_date === null || typeof item.launch_date === 'string')
						&& typeof item.document_number === 'string'
						&& typeof item.account_reference === 'string'
						&& typeof item.responsible === 'string'
						&& typeof item.observations === 'string'
						&& typeof item.updated_at === 'string')) {
					throw new Error('O banco retornou rascunhos financeiros em formato inválido.')
				}
				setLaunches(launchRows)
				setLaunchError('')
			} catch (draftLoadError) {
				setLaunches([])
				setLaunchError(draftLoadError instanceof BackendApiError
					? draftLoadError.message
					: draftLoadError instanceof Error ? draftLoadError.message : 'Não foi possível consultar os rascunhos financeiros.')
			}
		} catch (loadError) {
			setRepassePage({ items: [], total: 0, page, pageSize: PAGE_SIZE })
			setImports([])
			setLaunches([])
			setLaunchError('')
			setError(loadError instanceof BackendApiError
				? loadError.message
				: loadError instanceof Error ? loadError.message : 'Não foi possível consultar os registros importados.')
		} finally {
			setLoading(false)
		}
	}, [accessToken, hasSharedAccess, month, page, query, uf, year])

	useEffect(() => {
		void Promise.resolve().then(load)
		const refresh = () => { void load() }
		window.addEventListener('mck-fns-data-updated', refresh)
		return () => window.removeEventListener('mck-fns-data-updated', refresh)
	}, [load])

	const totalPages = Math.max(1, Math.ceil(repassePage.total / PAGE_SIZE))
	const setFilter = (setter: (value: string) => void, value: string) => {
		setter(value)
		setPage(1)
	}

	const openLaunchEditor = async (repasse: StoredRepasse) => {
		const context = launchContext(repasse)
		if (!context) {
			notify('error', 'Não foi possível abrir o lançamento: os dados originais do FNS estão indisponíveis.')
			return
		}
		const initialDraft = emptyFnsFinancialLaunchDraft(repasse.net_amount === null
			? '' : formatFnsFinancialLaunchAmount(repasse.net_amount))
		setSelectedRepasse(null)
		setEditingLaunch({
			repasse, action: context.action, actionKey: '', draft: initialDraft, originalDraft: initialDraft,
			saved: null, loading: true, saving: false, error: '',
		})
		try {
			const actionKey = await createFnsFinancialActionKey(context.entity, context.filters, context.action)
			const saved = launches.find((item) => item.action_key === actionKey)
				?? launches.find((item) => item.repasse_id === repasse.id)
				?? null
			const resolvedActionKey = saved?.action_key ?? actionKey
			const draft = saved ? launchDraftFromRow(saved) : initialDraft
			if (saved) draft.date = getFnsFinancialLaunchDate(draft.date)
			setEditingLaunch({
				repasse, action: context.action, actionKey: resolvedActionKey, draft, originalDraft: { ...draft },
				saved, loading: false, saving: false, error: '',
			})
		} catch (openError) {
			setEditingLaunch((current) => current ? {
				...current,
				loading: false,
				error: openError instanceof Error ? openError.message : 'Não foi possível carregar o lançamento financeiro.',
			} : current)
		}
	}

	const closeLaunchEditor = async () => {
		if (!editingLaunch) return
		if (!sameLaunchDraft(editingLaunch.draft, editingLaunch.originalDraft)) {
			const confirmed = await requestConfirmation({
				title: 'Descartar alterações pendentes?',
				description: 'Há alterações não salvas neste lançamento. Deseja descartá-las?',
				confirmLabel: 'Descartar alterações',
				icon: 'warning',
				onConfirm: () => {},
			})
			if (!confirmed) return
		}
		setEditingLaunch(null)
	}

	const saveLaunch = async () => {
		if (!editingLaunch || editingLaunch.loading || editingLaunch.saving || launchSaveInProgress.current
			|| !editingLaunch.actionKey || !hasSharedAccess) return
		const amount = parseFnsFinancialLaunchAmount(editingLaunch.draft.amount)
		if (amount === undefined || amount < 0) {
			setEditingLaunch((current) => current ? { ...current, error: 'Informe um valor lançado numérico e não negativo.' } : current)
			return
		}
		if (!isValidFnsFinancialLaunchDate(editingLaunch.draft.date)) {
			setEditingLaunch((current) => current ? { ...current, error: 'Informe uma data de lançamento válida.' } : current)
			return
		}
		if (editingLaunch.draft.documentNumber.length > 120 || editingLaunch.draft.accountReference.length > 160
			|| editingLaunch.draft.responsible.length > 120 || editingLaunch.draft.observations.length > 2000) {
			setEditingLaunch((current) => current ? { ...current, error: 'Revise os limites de caracteres dos campos do lançamento.' } : current)
			return
		}

		launchSaveInProgress.current = true
		setEditingLaunch((current) => current ? { ...current, saving: true, error: '' } : current)
		try {
			const now = new Date().toISOString()
			const payload = {
				action_key: editingLaunch.actionKey,
				repasse_id: editingLaunch.repasse.id,
				status: editingLaunch.draft.status,
				amount,
				launch_date: editingLaunch.draft.date || null,
				document_number: editingLaunch.draft.documentNumber,
				account_reference: editingLaunch.draft.accountReference,
				responsible: editingLaunch.draft.responsible,
				observations: editingLaunch.draft.observations,
				legacy_created_at: editingLaunch.saved?.created_at ?? now,
				legacy_updated_at: now,
			}
			const result = await backendRequest<unknown>(
				editingLaunch.saved
					? `/api/data/launches/${encodeURIComponent(editingLaunch.actionKey)}`
					: '/api/data/launches',
				accessToken,
				{ method: editingLaunch.saved ? 'PATCH' : 'POST', body: payload },
			)
			if (!Array.isArray(result) || result.length !== 1 || !isRecord(result[0])
				|| typeof result[0].action_key !== 'string' || typeof result[0].status !== 'string'
				|| (typeof result[0].amount !== 'number' && typeof result[0].amount !== 'string')
				|| typeof result[0].document_number !== 'string' || typeof result[0].account_reference !== 'string'
				|| typeof result[0].responsible !== 'string' || typeof result[0].observations !== 'string'
				|| typeof result[0].updated_at !== 'string'
				|| (result[0].launch_date !== null && typeof result[0].launch_date !== 'string')
				|| (result[0].repasse_id !== null && typeof result[0].repasse_id !== 'string')) {
				throw new Error('O lançamento não foi confirmado pelo banco de dados.')
			}
			const saved: StoredLaunch = {
				action_key: result[0].action_key,
				repasse_id: result[0].repasse_id as string | null,
				status: result[0].status,
				amount: result[0].amount,
				launch_date: result[0].launch_date as string | null,
				document_number: result[0].document_number,
				account_reference: result[0].account_reference,
				responsible: result[0].responsible,
				observations: result[0].observations,
				created_at: typeof result[0].created_at === 'string' ? result[0].created_at : now,
				updated_at: result[0].updated_at,
			}
			const draft = launchDraftFromRow(saved)
			setLaunches((current) => [...current.filter((item) => item.action_key !== saved.action_key), saved])
			setEditingLaunch((current) => current ? {
				...current, draft, originalDraft: { ...draft }, saved, saving: false, error: '',
			} : current)
			notify('success', 'Lançamento financeiro salvo no Supabase. Os dados oficiais do FNS não foram alterados.')
			window.dispatchEvent(new Event('mck-fns-data-updated'))
		} catch (saveError) {
			setEditingLaunch((current) => current ? {
				...current,
				error: saveError instanceof BackendApiError || saveError instanceof Error
					? saveError.message : 'Não foi possível salvar o lançamento financeiro.',
			} : current)
		} finally {
			launchSaveInProgress.current = false
			setEditingLaunch((current) => current ? { ...current, saving: false } : current)
		}
	}

	const updateLaunchDraft = <K extends keyof FnsFinancialLaunchDraft>(key: K, value: FnsFinancialLaunchDraft[K]) => {
		setEditingLaunch((current) => current ? { ...current, draft: { ...current.draft, [key]: value }, error: '' } : current)
	}

	return <div className="page-content repasses-imports-page">
		<div className="page-heading"><div><h2>Repasses importados</h2><p>Registros oficiais importados do FNS e consultados diretamente no Supabase.</p></div><button className="button" type="button" onClick={() => void load()} disabled={loading || sharedStorageLoading}><RefreshCw size={14} /> Atualizar</button></div>
		{!hasSharedAccess && <div className="notice notice-amber">{sharedStorageError || 'A persistência Supabase ainda não está disponível.'}</div>}
		{error && <div role="alert" className={`notice ${hasSharedAccess ? 'notice-error' : 'notice-amber'}`}>{error}</div>}
		<div className="repasses-sections">
		<section className="filter-panel"><div className="filter-grid repasses-filter-grid">
			<div className="field"><label htmlFor="stored-repasses-search">Buscar registros importados</label><input id="stored-repasses-search" value={query} onChange={(event) => setFilter(setQuery, event.target.value)} placeholder="Município, beneficiário ou identificador" /></div>
			<div className="field"><label htmlFor="stored-repasses-year">Ano</label><input id="stored-repasses-year" inputMode="numeric" maxLength={4} value={year} onChange={(event) => setFilter(setYear, event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Todos" /></div>
			<div className="field"><label htmlFor="stored-repasses-month">Mês</label><select id="stored-repasses-month" value={month} onChange={(event) => setFilter(setMonth, event.target.value)}><option value="">Todos</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={String(index + 1)}>{String(index + 1).padStart(2, '0')}</option>)}</select></div>
			<div className="field"><label htmlFor="stored-repasses-uf">UF</label><input id="stored-repasses-uf" maxLength={2} value={uf} onChange={(event) => setFilter(setUf, event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="Todas" /></div>
		</div></section>
		<section className="table-panel"><div className="table-toolbar"><strong>Registros oficiais</strong><span>{repassePage.total} registro(s) · página {page} de {totalPages}</span></div>
			{!hasSharedAccess ? <div className="empty-state">A consulta ao Supabase não está habilitada; nenhum resultado foi carregado.</div> : loading ? <div className="empty-state" role="status">Consultando o Supabase…</div> : error ? <div className="empty-state" role="alert">A consulta não foi concluída. Atualize ou ajuste os filtros e tente novamente.</div> : repassePage.items.length ? <div className="table-scroll"><table className="imported-repasses-table"><thead><tr><th>Período</th><th>Município/UF</th><th>Documento</th><th>Valor total</th><th>Descontos</th><th>Líquido</th><th>Ações</th></tr></thead><tbody>
				{repassePage.items.map((item) => <tr key={item.id}>
					<td>{item.reference_month === null ? '—' : String(item.reference_month).padStart(2, '0')}/{item.reference_year}</td>
					<td>{item.municipality_name || '—'}{item.municipality_uf ? ` · ${item.municipality_uf}` : ''}</td>
					<td>{formatDocument(item.beneficiary_cnpj)}</td>
					<td>{item.gross_amount === null ? '—' : formatCurrency(Number(item.gross_amount))}</td>
					<td>{item.discount_amount === null ? '—' : formatCurrency(Number(item.discount_amount))}</td>
					<td>{item.net_amount === null ? '—' : formatCurrency(Number(item.net_amount))}</td>
					<td><div className="table-actions imported-repasse-actions">
						<button className="button button-icon" type="button" title="Visualizar detalhes do repasse" aria-label={`Visualizar detalhes do repasse ${item.transfer_identifier || item.id}`} onClick={() => { setEditingLaunch(null); setSelectedRepasse(item) }}><Eye size={15} /></button>
						<button className="button button-icon" type="button" title="Editar lançamento financeiro" aria-label={`Editar lançamento financeiro ${item.transfer_identifier || item.id}`} disabled={!hasSharedAccess || sharedStorageLoading || !launchContext(item)} onClick={() => void openLaunchEditor(item)}><Pencil size={15} /></button>
					</div></td>
				</tr>)}
			</tbody></table></div> : <div className="empty-state"><strong>Nenhum repasse oficial importado</strong><span>Consulte o FNS e importe os registros que deseja conferir.</span></div>}
			<div className="form-footer imported-pagination"><button className="button" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={loading || page <= 1}><ChevronLeft size={14} /> Anterior</button><button className="button" type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={loading || page >= totalPages}><ChevronRight size={14} /> Próxima</button></div>
		</section>
		<section className="table-panel"><div className="table-toolbar"><strong>Rascunhos financeiros salvos</strong><span>{hasSharedAccess && !launchError ? `${launches.length} rascunho(s)` : 'Indisponível'}</span></div>{!hasSharedAccess || launchError ? <div className="empty-state launch-empty-state">{launchError || 'Os rascunhos financeiros não puderam ser consultados.'}</div> : launches.length ? <div className="table-scroll"><table className="saved-launches-table"><thead><tr><th>Repasse oficial relacionado</th><th>Situação</th><th>Valor lançado</th><th>Data do lançamento</th><th>Documento</th><th>Conta/referência</th><th>Responsável</th><th>Observações</th><th>Atualizado</th></tr></thead><tbody>{launches.map((item) => {
			const repasse = repassePage.items.find((row) => row.id === item.repasse_id)
			const repasseLabel = repasse
				? `${repasse.transfer_identifier ?? '—'} · ${repasse.reference_month ?? '—'}/${repasse.reference_year}`
				: item.repasse_id ? `ID ${item.repasse_id}` : 'Sem repasse oficial importado'
			return <tr key={item.action_key}><td>{repasseLabel}</td><td><span className="status-badge import-status-neutral">{item.status}</span></td><td>{formatCurrency(Number(item.amount))}</td><td>{formatDate(item.launch_date ?? undefined)}</td><td>{item.document_number || '—'}</td><td>{item.account_reference || '—'}</td><td>{item.responsible || '—'}</td><td>{item.observations || '—'}</td><td>{formatDateTime(item.updated_at)}</td></tr>
		})}</tbody></table></div> : <div className="empty-state launch-empty-state">Nenhum rascunho financeiro salvo.</div>}</section>
		<section className="table-panel"><div className="table-toolbar"><strong>Operações de importação</strong><span>{hasSharedAccess ? `${imports.length} operação(ões)` : 'Indisponível'}</span></div>{!hasSharedAccess || error ? <div className="empty-state">{!hasSharedAccess ? 'O histórico de importações não pôde ser consultado.' : error}</div> : imports.length ? <div className="table-scroll"><table className="import-history-table"><thead><tr><th>Iniciada em</th><th>Status</th><th>Encontrados</th><th>Importados</th><th>Atualizados</th><th>Ignorados</th></tr></thead><tbody>{imports.map((item) => <tr key={item.id}><td>{formatDateTime(item.started_at)}</td><td><span className={`status-badge ${getImportStatusClass(item.status)}`}>{item.status}</span></td><td>{item.records_found}</td><td>{item.records_imported}</td><td>{item.records_updated}</td><td>{item.records_ignored}</td></tr>)}</tbody></table></div> : <div className="empty-state">Nenhuma importação registrada.</div>}</section>
		</div>
		{selectedRepasse && <div className="financial-action-dialog-overlay" onMouseDown={(event) => {
			if (event.target === event.currentTarget) setSelectedRepasse(null)
		}}>
			<section className="financial-action-dialog repasse-details-dialog" role="dialog" aria-modal="true" aria-labelledby="repasse-details-title">
				<header className="financial-action-dialog-header"><div><h2 id="repasse-details-title">Detalhes do repasse oficial</h2><p>{selectedRepasse.transfer_identifier || selectedRepasse.beneficiary_name || 'Registro selecionado'}</p></div><button className="financial-action-dialog-close" type="button" aria-label="Fechar detalhes do repasse" onClick={() => setSelectedRepasse(null)}><X size={19} /></button></header>
				<div className="financial-action-dialog-content">
					{(() => {
						const action: FnsFinancialAction = { ...(selectedRepasse.source_data.record ?? {}) }
						const hasValue = (value: unknown) => value !== null && value !== undefined && value !== ''
						const location = [selectedRepasse.municipality_name, selectedRepasse.municipality_uf].filter(Boolean).join(' / ')
						const identification = [
							{ label: 'Período de referência', value: `${selectedRepasse.reference_month === null ? '—' : String(selectedRepasse.reference_month).padStart(2, '0')}/${selectedRepasse.reference_year}` },
							{ label: 'Município/UF', value: location },
							{ label: 'Beneficiário/entidade', value: selectedRepasse.beneficiary_name },
							{ label: 'CNPJ/CPF ou documento', value: formatDocument(selectedRepasse.beneficiary_cnpj) },
							{ label: 'Identificador oficial do FNS', value: selectedRepasse.transfer_identifier },
							{ label: 'Consultado em', value: selectedRepasse.consulted_at ? formatDateTime(selectedRepasse.consulted_at) : '' },
						].filter(({ value }) => hasValue(value))
						const financial = [
							{ label: 'Valor total', value: selectedRepasse.gross_amount },
							{ label: 'Descontos', value: selectedRepasse.discount_amount },
							{ label: 'Valor líquido', value: selectedRepasse.net_amount },
						].filter(({ value }) => value !== null)
						const actionDetails = [
							{ label: 'Descrição completa da ação', value: action.descricao },
							{ label: 'Forma de repasse', value: action.formaRepasse },
							{ label: 'Quantidade de parcelas', value: action.quantidadeParcelas },
							{ label: 'Ano de referência', value: selectedRepasse.reference_year },
							{ label: 'Mês de referência', value: selectedRepasse.reference_month },
							{ label: 'Tipo de consulta', value: selectedRepasse.query_type ?? stringValue(isRecord(selectedRepasse.source_data.filters) ? selectedRepasse.source_data.filters.queryType : '') },
						].filter(({ value }) => hasValue(value))
						const knownKeys = new Set(['descricao', 'formaRepasse', 'quantidadeParcelas', 'valorTotal', 'valorDescontoTotal', 'valorLiquido'])
						const additionalDetails = getFnsFinancialActionDetails(action)
							.filter(({ key, value }) => !knownKeys.has(key) && hasValue(value))
						return <>
							<section className="financial-action-detail-section"><h3>Identificação</h3><div className="financial-action-detail-grid">{identification.map(({ label, value }) => <FinancialDetail key={label} label={label} value={value} />)}</div></section>
							{financial.length > 0 && <section className="financial-action-detail-section"><h3>Informações financeiras</h3><div className="financial-action-detail-grid">{financial.map(({ label, value }) => <FinancialDetail key={label} label={label} value={value} financial />)}</div></section>}
							{(actionDetails.length > 0 || additionalDetails.length > 0) && <section className="financial-action-detail-section"><h3>Detalhes do repasse</h3><div className="financial-action-detail-grid">{actionDetails.map(({ label, value }) => <FinancialDetail key={label} label={label} value={value} />)}{additionalDetails.map(({ key, label, value, isFinancial }) => <FinancialDetail key={key} label={label} value={value} financial={isFinancial} />)}</div></section>}
						</>
					})()}
				</div>
				<footer className="financial-action-dialog-footer"><button className="button" type="button" onClick={() => setSelectedRepasse(null)}>Fechar</button></footer>
			</section>
		</div>}
		{editingLaunch && <div className="financial-action-dialog-overlay financial-launch-overlay" onMouseDown={(event) => {
			if (event.target === event.currentTarget) void closeLaunchEditor()
		}}>
			<section className="financial-action-dialog financial-launch-dialog" role="dialog" aria-modal="true" aria-labelledby="repasse-launch-dialog-title">
				<header className="financial-action-dialog-header"><div><h2 id="repasse-launch-dialog-title">Editar lançamento financeiro</h2><p>{officialValue(editingLaunch.action.descricao)}</p></div><button className="financial-action-dialog-close" type="button" aria-label="Fechar edição do lançamento" onClick={() => void closeLaunchEditor()}><X size={19} /></button></header>
				<form className="financial-launch-form" onSubmit={(event) => { event.preventDefault(); void saveLaunch() }}>
					<div className="financial-action-dialog-content financial-launch-content">
						{editingLaunch.loading ? <p className="financial-launch-status" role="status">Carregando dados salvos…</p> : <>
							<section className="financial-action-detail-section financial-launch-official">
								<h3>Dados oficiais do FNS — somente leitura</h3>
								<div className="financial-launch-readonly-grid">
									<div className="financial-launch-readonly"><strong>Entidade</strong><span>{officialValue(editingLaunch.repasse.beneficiary_name)}</span></div>
									<div className="financial-launch-readonly"><strong>Município/UF</strong><span>{officialValue(editingLaunch.repasse.municipality_name)}{editingLaunch.repasse.municipality_uf ? `/${editingLaunch.repasse.municipality_uf}` : ''}</span></div>
									<div className="financial-launch-readonly"><strong>Ano e mês</strong><span>{editingLaunch.repasse.reference_year} / {officialValue(editingLaunch.repasse.reference_month)}</span></div>
									<div className="financial-launch-readonly financial-launch-wide"><strong>Descrição da ação</strong><span>{officialValue(editingLaunch.action.descricao)}</span></div>
									<div className="financial-launch-readonly"><strong>Forma de repasse</strong><span>{officialValue(editingLaunch.action.formaRepasse)}</span></div>
									<div className="financial-launch-readonly"><strong>Quantidade de parcelas</strong><span>{officialValue(editingLaunch.action.quantidadeParcelas)}</span></div>
									<div className="financial-launch-readonly"><strong>Valor total</strong><span>{editingLaunch.repasse.gross_amount === null ? '—' : formatCurrency(editingLaunch.repasse.gross_amount)}</span></div>
									<div className="financial-launch-readonly"><strong>Descontos</strong><span>{editingLaunch.repasse.discount_amount === null ? '—' : formatCurrency(editingLaunch.repasse.discount_amount)}</span></div>
									<div className="financial-launch-readonly"><strong>Valor líquido</strong><span>{editingLaunch.repasse.net_amount === null ? '—' : formatCurrency(editingLaunch.repasse.net_amount)}</span></div>
								</div>
							</section>
							<section className="financial-action-detail-section financial-launch-internal">
								<h3>Dados internos do lançamento</h3>
								<div className="financial-launch-form-grid">
									<label className="financial-launch-field">Situação do lançamento<select value={editingLaunch.draft.status} onChange={(event) => updateLaunchDraft('status', event.target.value as FnsFinancialLaunchDraft['status'])}><option>Pendente</option><option>Em análise</option><option>Conferido</option><option>Lançado</option></select></label>
									<label className="financial-launch-field">Valor lançado (R$)<input type="text" inputMode="decimal" value={editingLaunch.draft.amount} onChange={(event) => updateLaunchDraft('amount', event.target.value)} placeholder="0,00" /></label>
									<label className="financial-launch-field">Data do lançamento<input type="date" value={editingLaunch.draft.date} onChange={(event) => updateLaunchDraft('date', event.target.value)} /></label>
									<label className="financial-launch-field">Número do documento<input type="text" maxLength={120} value={editingLaunch.draft.documentNumber} onChange={(event) => updateLaunchDraft('documentNumber', event.target.value)} /></label>
									<label className="financial-launch-field">Conta ou referência financeira<input type="text" maxLength={160} value={editingLaunch.draft.accountReference} onChange={(event) => updateLaunchDraft('accountReference', event.target.value)} /></label>
									<label className="financial-launch-field">Responsável pelo lançamento<input type="text" maxLength={120} value={editingLaunch.draft.responsible} onChange={(event) => updateLaunchDraft('responsible', event.target.value)} /></label>
									<label className="financial-launch-field financial-launch-wide">Observações<textarea rows={4} maxLength={2000} value={editingLaunch.draft.observations} onChange={(event) => updateLaunchDraft('observations', event.target.value)} /></label>
								</div>
							</section>
							<p className="financial-launch-disclaimer">Os dados internos são salvos no Supabase e não alteram os dados oficiais do FNS.</p>
							{editingLaunch.error && <p className="financial-launch-error" role="alert">{editingLaunch.error}</p>}
						</>}
					</div>
					<footer className="financial-action-dialog-footer financial-launch-footer"><button className="button" type="button" onClick={() => void closeLaunchEditor()}>Cancelar</button><button className="button button-primary" type="submit" disabled={!hasSharedAccess || editingLaunch.loading || editingLaunch.saving || !editingLaunch.actionKey}><Save size={14} /> {editingLaunch.saving ? 'Salvando…' : 'Salvar lançamento'}</button></footer>
				</form>
			</section>
		</div>}
	</div>
}
