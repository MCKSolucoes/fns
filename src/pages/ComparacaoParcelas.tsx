import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, RefreshCw, TrendingUp } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fnsResourcesService, FnsResourceError } from '../services/fnsResourcesService'
import { loadMonthlyComparison, type MonthlyComparisonResult } from '../services/monthlyComparisonService'
import type { AnoOption, MesOption, MunicipioOption, TipoConsultaOption } from '../types/fnsResources'
import type { InstallmentAlertType } from '../utils/monthlyInstallmentComparison'
import { financialActionCategory, formatMonthPeriod, previousMonth, sumFinancialActions } from '../utils/monthlyInstallmentComparison'
import { formatCurrency, normalized } from '../utils/formatters'
import { getDefaultConsultationType } from '../utils/consultationTypes'
import { backendRequest } from '../services/backendApi'
import { useBackendSession } from '../services/backendSession'

const PAGE_SIZE = 10
const ALERT_TYPES: InstallmentAlertType[] = ['Aumento', 'Redução', 'Sem alteração', 'Novo registro', 'Registro ausente', 'Sem dados para comparação']
const ALERT_COLORS = ['#cf837c', '#648eaa', '#709e6c', '#d9ad54', '#a2b48d', '#a5aaa6']

type ReportRow = MonthlyComparisonResult['rows'][number]

interface InstallmentReview {
	status: 'Pendente' | 'Analisado'
	justificativa: string
	updatedAt: string
}

function currentTimestamp(): string {
	return new Date().toISOString()
}

export default function ComparacaoParcelas() {
	const { accessToken, hasSharedAccess, sharedStorageLoading, sharedStorageError } = useBackendSession()
	const [years, setYears] = useState<AnoOption[]>([])
	const [months, setMonths] = useState<MesOption[]>([])
	const [municipalities, setMunicipalities] = useState<MunicipioOption[]>([])
	const [consultationTypes, setConsultationTypes] = useState<TipoConsultaOption[]>([])
	const [consultationTypesYear, setConsultationTypesYear] = useState('')
	const [year, setYear] = useState('')
	const [month, setMonth] = useState('')
	const [municipalityId, setMunicipalityId] = useState('')
	const [queryType, setQueryType] = useState('')
	const [resourceError, setResourceError] = useState('')
	const [result, setResult] = useState<MonthlyComparisonResult | null>(null)
	const [resultKey, setResultKey] = useState('')
	const [loading, setLoading] = useState(false)
	const [progress, setProgress] = useState('')
	const [error, setError] = useState('')
	const [alertType, setAlertType] = useState('')
	const [analysisStatus, setAnalysisStatus] = useState('')
	const [search, setSearch] = useState('')
	const [page, setPage] = useState(1)
	const [reviews, setReviews] = useState<Record<string, InstallmentReview>>({})
	const [reviewError, setReviewError] = useState('')
	const [editingReview, setEditingReview] = useState('')
	const [reviewDraft, setReviewDraft] = useState('')
	const [reviewSaveError, setReviewSaveError] = useState('')
	const requestController = useRef<AbortController | null>(null)

	useEffect(() => {
		let active = true
		Promise.all([
			fnsResourcesService.getAnos(),
			fnsResourcesService.getMeses(),
			fnsResourcesService.getMunicipios(),
		]).then(([yearOptions, monthOptions, municipalityOptions]) => {
			if (!active) return
			setYears(yearOptions)
			setMonths(monthOptions)
			setMunicipalities(municipalityOptions)
			const now = new Date()
			const currentMonth = String(now.getMonth() + 1)
			setYear((current) => current || yearOptions.find((item) => item.valor === String(now.getFullYear()))?.valor || yearOptions[0]?.valor || '')
			setMonth((current) => current || monthOptions.find((item) => String(item.valor) === currentMonth)?.valor.toString() || monthOptions.at(-1)?.valor.toString() || '')
			setMunicipalityId((current) => current || municipalityOptions[0]?.id || '')
		}).catch((loadError: unknown) => {
			if (active) setResourceError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os filtros oficiais do FNS.')
		})
		const loadReviews = async () => {
			try {
				if (sharedStorageLoading) return
				if (!hasSharedAccess) {
					if (active) {
						setReviews({})
						setReviewError(sharedStorageError || 'As análises e justificativas só podem ser carregadas quando o Supabase de desenvolvimento está conectado.')
					}
					return
				}
				const rows = await backendRequest<unknown>('/api/data/reviews', accessToken)
				if (!Array.isArray(rows)) throw new Error('O backend retornou análises em formato inválido.')
				const next: Record<string, InstallmentReview> = {}
				for (const item of rows) {
					if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('O backend retornou uma análise em formato inválido.')
					const row = item as Record<string, unknown>
					if (typeof row.alert_key !== 'string' || (row.status !== 'Pendente' && row.status !== 'Analisado')
						|| typeof row.justification !== 'string' || typeof row.occurred_at !== 'string') {
						throw new Error('O backend retornou uma análise incompleta.')
					}
					if (!next[row.alert_key]) next[row.alert_key] = {
						status: row.status,
						justificativa: row.justification,
						updatedAt: row.occurred_at,
					}
				}
				if (active) setReviews(next)
			} catch (loadError) {
				if (active) setReviewError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os status de análise.')
			}
		}
		void loadReviews()
		return () => {
			active = false
			requestController.current?.abort()
		}
	}, [accessToken, hasSharedAccess, sharedStorageError, sharedStorageLoading])

	useEffect(() => {
		if (!year) return
		let active = true
		fnsResourcesService.getTiposConsulta(year).then((options) => {
			if (!active) return
			setConsultationTypes(options)
			setConsultationTypesYear(year)
			setQueryType((current) => current && options.some((option) => String(option.valor) === current)
				? current
				: getDefaultConsultationType(options))
		}).catch((loadError: unknown) => {
			if (active) setResourceError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os tipos de consulta do FNS.')
		})
		return () => { active = false }
	}, [year])

	const municipality = municipalities.find((item) => item.id === municipalityId)
	const availableConsultationTypes = consultationTypesYear === year ? consultationTypes : []
	const period = { year, month }
	const previous = year && month ? previousMonth(period) : null
	const key = municipality && year && month ? JSON.stringify([year, month, queryType, municipality.id]) : ''
	const displayedResult = resultKey === key ? result : null
	const filteredRows = useMemo(() => (displayedResult?.rows ?? []).filter((row) => {
		const status = reviews[row.key]?.status ?? 'Pendente'
		return (!alertType || row.alertType === alertType)
			&& (!analysisStatus || status === analysisStatus)
			&& normalized(`${row.municipality} ${row.unit} ${row.description} ${row.actionId ?? ''} ${row.category} ${row.alertType} ${reviews[row.key]?.justificativa ?? ''}`).includes(normalized(search))
	}), [displayedResult, alertType, analysisStatus, search, reviews])
	const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
	const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

	const compare = async () => {
		if (!municipality || !year || !month) {
			setError('Selecione o ano, o mês e o município para consultar os dados oficiais.')
			return
		}
		requestController.current?.abort()
		const controller = new AbortController()
		requestController.current = controller
		setLoading(true)
		setError('')
		setResult(null)
		setResultKey(key)
		setProgress('Consultando entidades nos dois períodos...')
		setPage(1)
		try {
			const comparison = await loadMonthlyComparison(
				{ year, month, queryType, municipality },
				controller.signal,
				setProgress,
			)
			if (!controller.signal.aborted) setResult(comparison)
		} catch (loadError) {
			if (!controller.signal.aborted) {
				setError(loadError instanceof FnsResourceError
					? loadError.message
					: loadError instanceof Error ? loadError.message : 'Não foi possível comparar os dados oficiais do FNS.')
			}
		} finally {
			if (requestController.current === controller) {
				setLoading(false)
				setProgress('')
			}
		}
	}

	const saveReview = async (row: ReportRow) => {
		if (!hasSharedAccess) {
			setReviewSaveError('A análise não foi salva: o Supabase de desenvolvimento não está conectado.')
			return
		}
		const requiresReason = ['Aumento', 'Redução', 'Novo registro', 'Registro ausente'].includes(row.alertType)
		if (requiresReason && !reviewDraft.trim()) {
			setReviewSaveError('Informe a justificativa da análise para este alerta.')
			return
		}
		const review: InstallmentReview = {
				status: 'Analisado',
				justificativa: reviewDraft.trim(),
				updatedAt: currentTimestamp(),
			}
		try {
			const saved = await backendRequest<unknown>('/api/data/reviews', accessToken, {
				method: 'POST',
				body: {
					legacy_id: `review-event:${crypto.randomUUID()}`,
					alert_key: row.key,
					status: review.status,
					justification: review.justificativa,
					alert_snapshot: row,
				},
			})
			if (!Array.isArray(saved) || saved.length !== 1) throw new Error('A análise não foi confirmada pelo Supabase.')
			setReviews((current) => ({ ...current, [row.key]: review }))
			setEditingReview('')
			setReviewDraft('')
			setReviewSaveError('')
		} catch (saveError) {
			setReviewSaveError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar a análise.')
		}
	}

	const reopenReview = async (row: ReportRow) => {
		if (!hasSharedAccess) {
			setReviewSaveError('O status não foi atualizado: o Supabase de desenvolvimento não está conectado.')
			return
		}
		try {
			const review: InstallmentReview = {
				status: 'Pendente',
				justificativa: reviews[row.key]?.justificativa ?? '',
				updatedAt: currentTimestamp(),
			}
			const saved = await backendRequest<unknown>('/api/data/reviews', accessToken, {
				method: 'POST',
				body: {
					legacy_id: `review-event:${crypto.randomUUID()}`,
					alert_key: row.key,
					status: review.status,
					justification: review.justificativa,
					alert_snapshot: row,
				},
			})
			if (!Array.isArray(saved) || saved.length !== 1) throw new Error('O status não foi confirmado pelo Supabase.')
			setReviews((current) => ({ ...current, [row.key]: review }))
		} catch (saveError) {
			setReviewSaveError(saveError instanceof Error ? saveError.message : 'Não foi possível atualizar o status.')
		}
	}

	const chartData = useMemo(() => {
		if (!displayedResult) return null
		const units = displayedResult.units.map((unit) => ({
			name: unit.name,
			atual: sumFinancialActions(unit.currentActions) ?? null,
			anterior: sumFinancialActions(unit.previousActions) ?? null,
		})).filter((item) => item.atual !== null || item.anterior !== null)
		const categories = new Map<string, { name: string; atual: number | null; anterior: number | null }>()
		for (const unit of displayedResult.units) {
			for (const [actions, periodKey] of [[unit.currentActions, 'atual'], [unit.previousActions, 'anterior']] as const) {
				const sums = new Map<string, number>()
				for (const action of actions) {
					const category = financialActionCategory(action)
					const value = typeof action.valorLiquido === 'number'
						? action.valorLiquido
						: typeof action.valorLiquido === 'string' && /^\d+(?:\.\d+)?$/.test(action.valorLiquido.trim())
							? Number(action.valorLiquido)
							: undefined
					if (value === undefined || !Number.isFinite(value)) continue
					sums.set(category, Math.round(((sums.get(category) ?? 0) + value) * 100) / 100)
				}
				for (const [category, value] of sums) {
					const item = categories.get(category) ?? { name: category, atual: null, anterior: null }
					item[periodKey] = value
					categories.set(category, item)
				}
			}
		}
		const typeCounts = ALERT_TYPES.map((name, index) => ({
			name,
			value: displayedResult.rows.filter((row) => row.alertType === name).length,
			color: ALERT_COLORS[index],
		})).filter((item) => item.value > 0)
		return { units, categories: [...categories.values()], typeCounts }
	}, [displayedResult])

	const currentTotal = displayedResult?.currentTotal
	const previousTotal = displayedResult?.previousTotal
	const totalDifference = currentTotal !== undefined && previousTotal !== undefined
		? Math.round((currentTotal - previousTotal) * 100) / 100
		: undefined
	const totalVariation = totalDifference !== undefined && previousTotal !== undefined && previousTotal !== 0
		? totalDifference / previousTotal * 100
		: undefined
	const exceptionalAlerts = displayedResult?.rows.filter((row) => row.alertType !== 'Sem alteração').length ?? 0
	const unchangedCount = displayedResult?.rows.filter((row) => row.alertType === 'Sem alteração').length ?? 0

	return <div className="page-content comparison-page">
		<div className="page-heading"><div><h2>Comparação mensal de parcelas</h2><p>Compare os valores oficiais do FNS entre períodos consecutivos.</p></div></div>
		<div className="notice notice-blue"><TrendingUp size={15} /> Esta tela consulta novamente o FNS para o mês escolhido e o mês anterior. Os dados demonstrativos do sistema não são usados na comparação.</div>
		<div className="notice notice-amber" style={{ marginTop: 9 }}>{hasSharedAccess ? 'Status, justificativas e snapshots de cada análise são persistidos no Supabase.' : 'Status e justificativas não podem ser alterados enquanto o Supabase de desenvolvimento estiver desconectado.'}</div>
		{resourceError && <div role="alert" className="notice notice-error comparison-error">{resourceError}</div>}
		<form className="filter-panel comparison-filter" onSubmit={(event) => { event.preventDefault(); void compare() }}>
			<div className="filter-grid">
				<div className="field"><label htmlFor="comparison-year">Ano</label><select id="comparison-year" value={year} onChange={(event) => { setYear(event.target.value); setResult(null) }}><option value="">Selecione</option>{years.map((item) => <option key={item.valor} value={item.valor}>{item.descricao}</option>)}</select></div>
				<div className="field"><label htmlFor="comparison-month">Mês selecionado</label><select id="comparison-month" value={month} onChange={(event) => { setMonth(event.target.value); setResult(null) }}><option value="">Selecione</option>{months.map((item) => <option key={item.valor} value={item.valor}>{item.descricao}</option>)}</select></div>
				<div className="field"><label htmlFor="comparison-municipality">Município parceiro</label><select id="comparison-municipality" value={municipalityId} onChange={(event) => { setMunicipalityId(event.target.value); setResult(null) }}><option value="">Selecione</option>{municipalities.map((item) => <option key={item.id} value={item.id}>{item.noMunicipio} · {item.sgUf}</option>)}</select></div>
				<div className="field"><label htmlFor="comparison-type">Tipo de consulta</label><select id="comparison-type" value={queryType} onChange={(event) => { setQueryType(event.target.value); setResult(null) }}><option value="">Todos</option>{availableConsultationTypes.map((item) => <option key={item.valor} value={item.valor}>{item.descricao}</option>)}</select></div>
			</div>
			<div className="comparison-period-note">{year && month && previous ? <>Comparando <strong>{formatMonthPeriod(period)}</strong> com <strong>{formatMonthPeriod(previous)}</strong>.</> : 'Selecione os filtros para consultar o FNS.'}</div>
			{error && <div role="alert" className="notice notice-error" style={{ marginTop: 12 }}>{error}</div>}
			<div className="filter-actions"><button className="button button-primary" type="submit" disabled={loading || !municipality || !year || !month || consultationTypesYear !== year}>{loading ? <><RefreshCw size={14} className="comparison-spin" /> Consultando FNS…</> : <><TrendingUp size={14} /> Comparar meses</>}</button>{loading && <span role="status" className="comparison-progress">{progress}</span>}</div>
		</form>

		{displayedResult && <section aria-label="Resumo da comparação">
			{displayedResult.currentEntities === 0 && displayedResult.previousEntities === 0
				? <div className="notice notice-amber comparison-empty"><AlertTriangle size={16} /> O FNS não retornou entidades em nenhum dos dois períodos. Não há dados históricos suficientes para concluir a comparação.</div>
				: <div className="metric-grid comparison-metrics">
					<Metric label={`Total · ${formatMonthPeriod(period)}`} value={currencyOrNoData(currentTotal)} />
					<Metric label={`Total · ${formatMonthPeriod(previous!)}`} value={currencyOrNoData(previousTotal)} />
					<Metric label="Diferença total" value={totalDifference === undefined ? 'Sem base comparável' : formatCurrency(totalDifference)} foot={totalDifference === undefined ? 'Dados insuficientes em um dos períodos' : totalVariation === undefined ? 'Variação percentual não calculável: base anterior zero' : `${formatPercentage(totalVariation)} em relação ao mês anterior`} change={totalDifference} />
					<Metric label="Alertas para análise" value={String(exceptionalAlerts)} foot={`${unchangedCount} parcela(s) sem alteração`} />
				</div>}

			{chartData && (chartData.units.length > 0 || chartData.categories.length > 0) && <div className="comparison-charts">
				<section className="panel"><div className="panel-heading"><h3>Comparação por município</h3><span>{municipality?.noMunicipio} · valor líquido oficial</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ name: municipality?.noMunicipio ?? 'Município', atual: currentTotal ?? null, anterior: previousTotal ?? null }]} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}><CartesianGrid stroke="#edf0ec" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10, fill: '#78847a' }} axisLine={false} tickLine={false} /><YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)} mil`} tick={{ fontSize: 10, fill: '#78847a' }} axisLine={false} tickLine={false} width={48} /><Tooltip formatter={(value) => value === null || value === undefined ? 'Sem dados' : formatCurrency(Number(value))} /><Bar dataKey="anterior" name={formatMonthPeriod(previous!)} fill="#9ba89b" radius={[4, 4, 0, 0]} /><Bar dataKey="atual" name={formatMonthPeriod(period)} fill="#709e6c" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div><ChartLegend current={formatMonthPeriod(period)} previous={formatMonthPeriod(previous!)} /></section>
				<section className="panel"><div className="panel-heading"><h3>Comparação por unidade de saúde</h3><span>{chartData.units.length} unidade(s)</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData.units} margin={{ top: 8, right: 12, left: 4, bottom: 38 }}><CartesianGrid stroke="#edf0ec" vertical={false} /><XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={55} tick={{ fontSize: 9, fill: '#78847a' }} axisLine={false} tickLine={false} /><YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)} mil`} tick={{ fontSize: 10, fill: '#78847a' }} axisLine={false} tickLine={false} width={48} /><Tooltip formatter={(value) => value === null || value === undefined ? 'Sem dados' : formatCurrency(Number(value))} /><Bar dataKey="anterior" name={formatMonthPeriod(previous!)} fill="#9ba89b" /><Bar dataKey="atual" name={formatMonthPeriod(period)} fill="#709e6c" /></BarChart></ResponsiveContainer></div><ChartLegend current={formatMonthPeriod(period)} previous={formatMonthPeriod(previous!)} /></section>
				<section className="panel"><div className="panel-heading"><h3>Comparação por categoria</h3><span>Grupo, componente ou forma de repasse</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData.categories} margin={{ top: 8, right: 12, left: 4, bottom: 38 }}><CartesianGrid stroke="#edf0ec" vertical={false} /><XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={55} tick={{ fontSize: 9, fill: '#78847a' }} axisLine={false} tickLine={false} /><YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)} mil`} tick={{ fontSize: 10, fill: '#78847a' }} axisLine={false} tickLine={false} width={48} /><Tooltip formatter={(value) => value === null || value === undefined ? 'Sem dados' : formatCurrency(Number(value))} /><Bar dataKey="anterior" name={formatMonthPeriod(previous!)} fill="#9ba89b" /><Bar dataKey="atual" name={formatMonthPeriod(period)} fill="#709e6c" /></BarChart></ResponsiveContainer></div><ChartLegend current={formatMonthPeriod(period)} previous={formatMonthPeriod(previous!)} /></section>
				<section className="panel"><div className="panel-heading"><h3>Parcelas por tipo de alerta</h3><span>{displayedResult.rows.length} registro(s)</span></div><div className="chart-wrap comparison-pie-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chartData.typeCounts} dataKey="value" nameKey="name" innerRadius={45} outerRadius={78} paddingAngle={3}>{chartData.typeCounts.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip formatter={(value, name) => [`${value} parcela(s)`, name]} /></PieChart></ResponsiveContainer></div><div className="comparison-type-legend">{chartData.typeCounts.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}: {item.value}</span>)}</div></section>
			</div>}

			<section className="comparison-alerts" aria-labelledby="parcel-alerts-heading">
				<div className="comparison-section-heading"><div><h3 id="parcel-alerts-heading">Alertas de Parcelas</h3><p>Divergências entre os valores mensais devem ser analisadas; não significam necessariamente erro.</p></div><span>{filteredRows.length} registro(s)</span></div>
				{!hasSharedAccess && !sharedStorageLoading && <div className="notice notice-amber">Análises e justificativas só podem ser alteradas com o Supabase de desenvolvimento conectado.</div>}
				{reviewError && <div role="alert" className="notice notice-error">{reviewError}</div>}
				{reviewSaveError && <div role="alert" className="notice notice-error">{reviewSaveError}</div>}
				<div className="filter-panel comparison-alert-filters"><div className="filter-grid comparison-alert-filter-grid">
					<div className="field"><label htmlFor="alert-search">Buscar</label><input id="alert-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Unidade, ação ou justificativa" /></div>
					<div className="field"><label htmlFor="alert-type-filter">Tipo de alerta</label><select id="alert-type-filter" value={alertType} onChange={(event) => { setAlertType(event.target.value); setPage(1) }}><option value="">Todos</option>{ALERT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></div>
					<div className="field"><label htmlFor="alert-status-filter">Status da análise</label><select id="alert-status-filter" value={analysisStatus} onChange={(event) => { setAnalysisStatus(event.target.value); setPage(1) }}><option value="">Todos</option><option>Pendente</option><option>Analisado</option></select></div>
					<div className="field"><span className="field-label">Períodos consultados</span><div className="readonly-value">{formatMonthPeriod(period)} · {formatMonthPeriod(previous!)}</div></div>
				</div></div>
				<div className="table-panel"><div className="table-toolbar"><strong>{municipality?.noMunicipio} · {formatMonthPeriod(period)} × {formatMonthPeriod(previous!)}</strong><span>{filteredRows.length} parcela(s)</span></div>
					{pageRows.length ? <div className="table-scroll"><table className="comparison-table"><thead><tr><th>Município</th><th>Unidade de saúde</th><th>Parcela/ação FNS</th><th>Período atual</th><th>Período anterior</th><th>Diferença</th><th>Variação</th><th>Alerta</th><th>Análise</th><th>Ação</th></tr></thead><tbody>
						{pageRows.map((row) => <AlertTableRow key={row.key} row={row} current={period} previous={previous!} review={reviews[row.key]} canWrite={hasSharedAccess && !sharedStorageLoading} editing={editingReview === row.key} reviewDraft={reviewDraft} onEdit={() => { setEditingReview(row.key); setReviewDraft(reviews[row.key]?.justificativa ?? ''); setReviewSaveError('') }} onCancel={() => { setEditingReview(''); setReviewSaveError('') }} onDraft={setReviewDraft} onSave={() => saveReview(row)} onReopen={() => reopenReview(row)} />)}
					</tbody></table></div> : <div className="empty-state"><AlertTriangle size={24} /><strong>{filteredRows.length === 0 && displayedResult.rows.length === 0 ? 'Sem parcelas para comparar' : 'Nenhum alerta corresponde aos filtros'}</strong><span>{displayedResult.rows.length === 0 ? 'O FNS não retornou ações financeiras comparáveis para este município e estes períodos.' : 'Ajuste os filtros para visualizar outros resultados.'}</span></div>}
					<div className="pagination"><span>Mostrando {filteredRows.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, filteredRows.length)} de {filteredRows.length}</span><div className="pagination-controls"><button className="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button><span>Página {page} de {pageCount}</span><button className="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Próxima</button></div></div>
				</div>
			</section>
		</section>}
	</div>
}

function AlertTableRow({ row, current, previous, review, canWrite, editing, reviewDraft, onEdit, onCancel, onDraft, onSave, onReopen }: {
	row: ReportRow
	current: { year: string; month: string }
	previous: { year: string; month: string }
	review?: InstallmentReview
	canWrite: boolean
	editing: boolean
	reviewDraft: string
	onEdit: () => void
	onCancel: () => void
	onDraft: (value: string) => void
	onSave: () => void
	onReopen: () => void
}) {
	const analysis = review?.status ?? 'Pendente'
	return <tr>
		<td>{row.municipality}</td><td>{row.unit}</td><td><span className="primary-cell">{row.description}</span><div className="secondary-cell">{row.actionId ? `ID FNS: ${row.actionId}` : row.category}</div></td>
		<td>{row.currentValue === undefined ? 'Sem dados' : formatCurrency(row.currentValue)}<div className="secondary-cell">{formatMonthPeriod(current)}</div></td>
		<td>{row.previousValue === undefined ? 'Sem dados' : formatCurrency(row.previousValue)}<div className="secondary-cell">{formatMonthPeriod(previous)}</div></td>
		<td>{row.difference === undefined ? '—' : formatCurrency(row.difference)}</td>
		<td>{row.percentage !== undefined ? formatPercentage(row.percentage) : row.alertType === 'Aumento' || row.alertType === 'Redução' ? 'Não calculável (base zero)' : '—'}</td>
		<td><AlertBadge type={row.alertType} /></td>
		<td><span className={`analysis-badge ${analysis === 'Analisado' ? 'analysis-complete' : ''}`}>{analysis}</span>{review?.justificativa && <div className="secondary-cell comparison-review-note">{review.justificativa}</div>}</td>
		<td>{editing ? <div className="comparison-review-editor"><textarea aria-label="Justificativa da análise" value={reviewDraft} onChange={(event) => onDraft(event.target.value)} placeholder="Justificativa da análise" /><div><button className="button button-primary" onClick={onSave} disabled={!canWrite}>Salvar análise</button><button className="button" onClick={onCancel}>Cancelar</button></div></div> : analysis === 'Analisado' ? <button className="text-action" onClick={onReopen} disabled={!canWrite}>Reabrir análise</button> : <button className="text-action" onClick={onEdit} disabled={!canWrite}>Analisar</button>}</td>
	</tr>
}

function Metric({ label, value, foot, change }: { label: string; value: string; foot?: string; change?: number }) {
	const icon = change === undefined ? <AlertTriangle size={16} /> : change > 0 ? <ArrowUp size={16} /> : change < 0 ? <ArrowDown size={16} /> : <CheckCircle2 size={16} />
	return <div className="metric"><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{value}</div>{foot && <div className="metric-foot">{foot}</div>}</div>
}

function AlertBadge({ type }: { type: InstallmentAlertType }) {
	const style = type === 'Aumento' ? 'alert-increase'
		: type === 'Redução' ? 'alert-decrease'
			: type === 'Sem alteração' ? 'alert-equal'
				: type === 'Sem dados para comparação' ? 'alert-no-data' : 'alert-new'
	return <span className={`installment-alert-badge ${style}`}>{type}</span>
}

function ChartLegend({ current, previous }: { current: string; previous: string }) {
	return <div className="comparison-chart-legend"><span><i className="legend-previous" />{previous}</span><span><i className="legend-current" />{current}</span></div>
}

function currencyOrNoData(value: number | undefined): string {
	return value === undefined ? 'Sem dados' : formatCurrency(value)
}

function formatPercentage(value: number): string {
	return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)}%`
}
