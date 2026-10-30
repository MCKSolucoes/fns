import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, Download, Eye, Pencil, Save, Search, UsersRound, X } from 'lucide-react'
import { useFnsResources, type ResourceState } from '../hooks/useFnsResources'
import { fnsResourcesService, FnsResourceError } from '../services/fnsResourcesService'
import { getAllFnsFinancialPages, getFinancialBlockSummary, getFinancialGeneralTotals, getFnsFinancialPage, mergeFnsFinancialAggregates, type FnsFinancialAggregateSummary } from '../services/fnsFinancialService'
import type { ConsultationFilters } from '../types'
import { getDefaultConsultationType } from '../utils/consultationTypes'
import { findMunicipalityByName, getConsultationMunicipalityCode, searchMunicipalities } from '../utils/municipalitySearch'
import type { MunicipioOption } from '../types/fnsResources'
import type { MesOption } from '../types/fnsResources'
import { formatConsultationMonth } from '../utils/consultationMonth'
import { getActivePartnerMunicipality, getActivePartnerMunicipalities, partnerStates } from '../data/partnerMunicipalities'
import type { FnsConsultationFilters, FnsConsultationResponse } from '../types/fnsConsultation'
import type { FnsFinancialAction, FnsFinancialComplement, FnsFinancialEntity, FnsFinancialFilters, FnsFinancialLaunch, FnsFinancialLaunchDraft, FnsFinancialResponse, SavedFnsFinancialComplement } from '../types/fnsFinancial'
import { getFnsMunicipalLeadership } from '../services/fnsLeadershipService'
import type { FnsMunicipalLeadership } from '../types/fnsLeadership'
import { useFeedback } from '../services/feedbackContext'
import { formatFnsFinancialActionDetail, getFnsFinancialActionDetails } from '../utils/fnsFinancialActionDetails'
import { createFnsFinancialActionKey } from '../utils/fnsFinancialActionKey'
import { emptyFnsFinancialLaunchDraft, formatFnsFinancialLaunchAmount, getFnsFinancialLaunchDate, isValidFnsFinancialLaunchDate, parseFnsFinancialLaunchAmount } from '../utils/fnsFinancialLaunch'
import { backendRequest, BackendApiError } from '../services/backendApi'
import { useBackendSession } from '../services/backendSession'
import { useAppData } from '../hooks/useAppData'

const initialFilters: ConsultationFilters = { year: '', month: '', queryType: '', block: '', group: '', document: '', state: '', city: '', cityCode: '', processNumber: '', proposal: '', transferType: '', dateFrom: '', dateTo: '', portaria: '' }
const PAGE_SIZE = 8
const FINANCIAL_PAGE_SIZE = 10
const EMPTY_FINANCIAL_ACTIONS: FnsFinancialAction[] = []
const emptyFinancialComplement: FnsFinancialComplement = {
	observations: '',
	reviewStatus: '',
	reviewResponsible: '',
	internalReference: '',
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function savedComplementFromRow(value: unknown): SavedFnsFinancialComplement {
	if (!isRecord(value) || typeof value.observations !== 'string' || typeof value.review_status !== 'string'
		|| typeof value.review_responsible !== 'string' || typeof value.internal_reference !== 'string'
		|| typeof (value.legacy_updated_at ?? value.updated_at) !== 'string') {
		throw new Error('O backend retornou um complemento financeiro incompleto.')
	}
	return {
		observations: value.observations,
		reviewStatus: value.review_status as FnsFinancialComplement['reviewStatus'],
		reviewResponsible: value.review_responsible,
		internalReference: value.internal_reference,
		updatedAt: (value.legacy_updated_at ?? value.updated_at) as string,
	}
}

function launchFromRow(value: unknown): FnsFinancialLaunch {
	if (!isRecord(value) || typeof value.action_key !== 'string' || typeof value.status !== 'string'
		|| (typeof value.amount !== 'string' && typeof value.amount !== 'number')
		|| typeof value.document_number !== 'string' || typeof value.account_reference !== 'string'
		|| typeof value.responsible !== 'string' || typeof value.observations !== 'string'
		|| typeof (value.legacy_created_at ?? value.created_at) !== 'string'
		|| typeof (value.legacy_updated_at ?? value.updated_at) !== 'string') {
		throw new Error('O backend retornou um rascunho financeiro incompleto.')
	}
	return {
		actionKey: value.action_key,
		status: value.status as FnsFinancialLaunch['status'],
		amount: String(value.amount),
		date: typeof value.launch_date === 'string' ? value.launch_date : '',
		documentNumber: value.document_number,
		accountReference: value.account_reference,
		responsible: value.responsible,
		observations: value.observations,
		...(typeof value.repasse_id === 'string' ? { repasseId: value.repasse_id } : {}),
		createdAt: (value.legacy_created_at ?? value.created_at) as string,
		updatedAt: (value.legacy_updated_at ?? value.updated_at) as string,
	}
}

async function loadRemoteLaunch(actionKey: string, accessToken: string): Promise<FnsFinancialLaunch | null> {
	const rows = await backendRequest<unknown>(`/api/data/launches?key=${encodeURIComponent(actionKey)}`, accessToken)
	if (!Array.isArray(rows) || rows.length > 1) throw new Error('O backend retornou rascunhos financeiros em formato inválido.')
	return rows.length ? launchFromRow(rows[0]) : null
}

async function findImportedRepasseId(
	action: FnsFinancialAction,
	entity: FnsFinancialEntity,
	filters: ConsultationFilters,
	accessToken: string,
): Promise<string | null> {
	const municipality = getActivePartnerMunicipality(filters.cityCode)
	const identifier = action.id
	const document = String(entity.cpfCnpj ?? entity.cpfCnpjFormatado ?? '').replace(/\D/g, '')
	if (!municipality || (typeof identifier !== 'string' && typeof identifier !== 'number')
		|| !String(identifier).trim() || String(identifier) === '0' || !/^\d{4}$/.test(filters.year)
		|| ![11, 14].includes(document.length)) {
		return null
	}
	const params = new URLSearchParams({
		match: 'financialAction',
		page: '1',
		pageSize: '2',
		matchYear: filters.year,
		matchMonth: filters.month || 'null',
		matchQueryType: filters.queryType,
		matchUf: municipality.uf,
		matchMunicipalityIbge: municipality.ibgeCode,
		matchBeneficiaryCnpj: document,
		matchTransferIdentifier: String(identifier),
	})
	const result = await backendRequest<{ items: Array<{ id: string }>; total: number }>(`/api/data/repasses?${params}`, accessToken)
	if (!result || !Array.isArray(result.items) || !Number.isInteger(result.total)
		|| result.total !== result.items.length || result.total > 1
		|| !result.items.every((item) => isRecord(item) && typeof item.id === 'string')) {
		throw new Error('Não foi possível vincular o rascunho a um repasse oficial único no Supabase.')
	}
	return result.items[0]?.id ?? null
}

export default function Consultas() {
	const [draft, setDraft] = useState(initialFilters)
	const resources = useFnsResources(draft.year, draft.queryType)
	const [filters, setFilters] = useState(initialFilters)
	const [submitted, setSubmitted] = useState(false)
	const [error, setError] = useState('')
	const [retryable, setRetryable] = useState(false)
	const [loading, setLoading] = useState(false)
	const [response, setResponse] = useState<FnsConsultationResponse | null>(null)
	const [page, setPage] = useState(1)
	const [financialEntity, setFinancialEntity] = useState<FnsFinancialEntity | null>(null)
	const [financialResponse, setFinancialResponse] = useState<FnsFinancialResponse | null>(null)
	const [financialAggregates, setFinancialAggregates] = useState<FnsFinancialAggregateSummary | null>(null)
	const [financialPage, setFinancialPage] = useState(1)
	const [financialPageSize, setFinancialPageSize] = useState(FINANCIAL_PAGE_SIZE)
	const [financialLoading, setFinancialLoading] = useState(false)
	const [financialError, setFinancialError] = useState('')
	const [financialRetryable, setFinancialRetryable] = useState(false)
	const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx' | 'pdf'>('xlsx')
	const [exportAll, setExportAll] = useState(false)
	const [exporting, setExporting] = useState(false)
	const [exportProgress, setExportProgress] = useState('')
	const [exportError, setExportError] = useState('')
	const queryTypeValidationId = useRef(0)
	const requestId = useRef(0)
	const entityController = useRef<AbortController | null>(null)
	const entityRequests = useRef(new Map<string, { promise: Promise<void>; controller: AbortController }>())
	const financialRequestId = useRef(0)
	const financialController = useRef<AbortController | null>(null)
	const exportController = useRef<AbortController | null>(null)
	const update = (key: keyof ConsultationFilters, value: string) => setDraft((current) => ({ ...current, [key]: value }))
	const toFnsFilters = (value: ConsultationFilters): FnsConsultationFilters => {
		const uf = states.find((state) => state.id === value.state)
		return {
			ano: value.year,
			mes: value.month,
			tipoConsulta: value.queryType,
			estado: uf?.sigla ?? '',
			municipio: value.cityCode,
			blocos: value.block,
			grupo: value.group,
			cpfCnpjUg: value.document,
			processo: value.processNumber,
			proposta: value.proposal,
			repasse: value.transferType,
			dataInicialOb: value.dateFrom,
			dataFinalOb: value.dateTo,
			portaria: value.portaria,
		}
	}
	const toFinancialFilters = (entity: FnsFinancialEntity, value: ConsultationFilters, requestedPage: number, count = FINANCIAL_PAGE_SIZE): FnsFinancialFilters => {
		const document = entity.cpfCnpj
		if (typeof document !== 'string' && typeof document !== 'number') {
			throw new FnsResourceError('A entidade selecionada não retornou CPF/CNPJ para a consulta financeira.')
		}
		const uf = states.find((state) => state.id === value.state)?.sigla
		return {
			ano: value.year || undefined,
			count,
			cpfCnpjUg: String(document),
			estado: uf || undefined,
			mes: value.month || undefined,
			municipio: value.cityCode || undefined,
			page: requestedPage,
			tipoConsulta: value.queryType || undefined,
		}
	}
	const financialContextKey = (entity: FnsFinancialEntity, value: ConsultationFilters): string => {
		const filtersForEntity = toFinancialFilters(entity, value, 1)
		return JSON.stringify(Object.fromEntries(Object.entries(filtersForEntity).filter(([key]) => key !== 'page' && key !== 'count')))
	}
	const loadPage = (value: ConsultationFilters, requestedPage: number): Promise<void> => {
		const queryFilters = toFnsFilters(value)
		const key = JSON.stringify({ filters: queryFilters, page: requestedPage, count: PAGE_SIZE })
		const existing = entityRequests.current.get(key)
		if (existing && !existing.controller.signal.aborted) return existing.promise
		if (existing) entityRequests.current.delete(key)

		entityController.current?.abort()
		const controller = new AbortController()
		entityController.current = controller
		const currentRequest = ++requestId.current
		setLoading(true)
		setError('')
		setRetryable(false)
		setResponse(null)
		let request: Promise<void>
		request = fnsResourcesService.getConsultas(queryFilters, requestedPage, PAGE_SIZE, controller.signal).then((result) => {
			if (requestId.current === currentRequest) setResponse(result)
		}).catch((loadError: unknown) => {
			if (requestId.current === currentRequest) {
				if (!controller.signal.aborted) {
					setError(loadError instanceof Error ? loadError.message : 'Não foi possível consultar os repasses oficiais do FNS.')
					setRetryable(loadError instanceof FnsResourceError && loadError.retryable)
				}
			}
		}).finally(() => {
			if (requestId.current === currentRequest) setLoading(false)
			if (entityRequests.current.get(key)?.promise === request) entityRequests.current.delete(key)
		})
		entityRequests.current.set(key, { promise: request, controller })
		return request
	}
	const updateYear = (year: string) => {
		const validationId = ++queryTypeValidationId.current
		setDraft((current) => ({ ...current, year, queryType: '', block: '' }))
		setError('')
		if (!year) return
		fnsResourcesService.getTiposConsulta(year).then((items) => {
			if (queryTypeValidationId.current !== validationId) return
			const defaultType = getDefaultConsultationType(items)
			setDraft((current) => current.year === year && !current.queryType ? { ...current, queryType: defaultType } : current)
		}).catch((error: unknown) => {
			if (queryTypeValidationId.current === validationId) setError(error instanceof Error ? error.message : 'Não foi possível validar o tipo de consulta para o novo ano.')
		})
	}
	const states = partnerStates.map((state) => ({
		coUfIbge: state.ibgeCode,
		sigla: state.uf,
		nome: state.name,
		registroAtivo: 'S',
		id: state.ibgeCode,
	}))
	const selectedUf = states.find((state) => state.id === draft.state)?.sigla
	const partnerMunicipalityOptions: MunicipioOption[] = getActivePartnerMunicipalities(selectedUf).map((municipality) => ({
		coMunicipioIbge: municipality.ibgeCode,
		noMunicipio: municipality.name,
		sgUf: municipality.uf,
		id: municipality.ibgeCode,
	}))
	const municipalityOptions = searchMunicipalities(partnerMunicipalityOptions, selectedUf ?? '', draft.city)
	const consultationTypeResource = resources.consultationTypes
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (loading) return
		financialController.current?.abort()
		exportController.current?.abort()
		setFinancialEntity(null)
		setFinancialResponse(null)
		setRetryable(false)
		if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) {
			setError('A data inicial da Ordem Bancária não pode ser posterior à data final.')
			setSubmitted(false)
			return
		}
		const selectedState = states.find((state) => state.id === draft.state)
		if (!selectedState || !draft.cityCode || !getActivePartnerMunicipality(draft.cityCode, selectedState.sigla)) {
			setError('Selecione uma UF e um município parceiro ativo da lista autorizada.')
			setSubmitted(false)
			return
		}
		setError('')
		setFilters(draft)
		setSubmitted(true)
		setPage(1)
		void loadPage(draft, 1)
	}
	const clear = () => {
		queryTypeValidationId.current += 1
		requestId.current += 1
		entityController.current?.abort()
		entityController.current = null
		entityRequests.current.clear()
		financialController.current?.abort()
		exportController.current?.abort()
		setDraft(initialFilters)
		setFilters(initialFilters)
		setSubmitted(false)
		setError('')
		setRetryable(false)
		setLoading(false)
		setResponse(null)
		setPage(1)
		setFinancialEntity(null)
		setFinancialResponse(null)
	}
	const goToPage = (nextPage: number) => {
		setPage(nextPage)
		void loadPage(filters, nextPage)
	}
	const loadFinancialPage = async (entity: FnsFinancialEntity, requestedPage: number, requestedPageSize = financialPageSize) => {
		financialController.current?.abort()
		const controller = new AbortController()
		financialController.current = controller
		const currentRequest = ++financialRequestId.current
		const contextKey = financialContextKey(entity, filters)
		setFinancialEntity(entity)
		setFinancialPage(requestedPage)
		setFinancialLoading(true)
		setFinancialError('')
		setFinancialRetryable(false)
		setFinancialResponse(null)
		setExportError('')
		try {
			const result = await getFnsFinancialPage(toFinancialFilters(entity, filters, requestedPage, requestedPageSize), controller.signal)
			if (financialRequestId.current === currentRequest) {
				if (requestedPage > result.totalPaginas && result.totalPaginas > 0) {
					await loadFinancialPage(entity, result.totalPaginas, requestedPageSize)
					return
				}
				if (requestedPage > 1 && result.totalPaginas === 0) {
					await loadFinancialPage(entity, 1, requestedPageSize)
					return
				}
				setFinancialResponse(result)
				setFinancialAggregates((current) => mergeFnsFinancialAggregates(current, contextKey, result.dados))
			}
		} catch (loadError) {
			if (!controller.signal.aborted && financialRequestId.current === currentRequest) {
				setFinancialError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os dados financeiros do FNS.')
				setFinancialRetryable(loadError instanceof FnsResourceError && loadError.retryable)
			}
		} finally {
			if (financialRequestId.current === currentRequest) setFinancialLoading(false)
		}
	}
	const returnToResults = () => {
		financialController.current?.abort()
		exportController.current?.abort()
		financialRequestId.current += 1
		setFinancialEntity(null)
		setFinancialLoading(false)
		setExporting(false)
		setExportProgress('')
	}
	const exportFinancialData = async () => {
		if (!financialEntity || !financialResponse) return
		const controller = new AbortController()
		exportController.current?.abort()
		exportController.current = controller
		setExporting(true)
		setExportError('')
		setExportProgress(exportAll
			? `Preparando exportação de todas as ${financialResponse.totalPaginas} páginas…`
			: `Exportando a página ${financialResponse.pagina} de ${financialResponse.totalPaginas} carregada.`)
		try {
			const financialFilters = toFinancialFilters(financialEntity, filters, 1, 100)
			const exportResponse = exportAll
				? await getAllFnsFinancialPages(financialFilters, controller.signal, (loadedPages, totalPages) => {
					setExportProgress(`Carregando dados para exportação: página ${loadedPages} de ${totalPages}.`)
				})
				: financialResponse
			const { downloadFinancialExport } = await import('../services/fnsFinancialExports')
			if (controller.signal.aborted) return
			await downloadFinancialExport(exportFormat, {
				entity: financialEntity,
				filters: {
					ano: financialFilters.ano,
					cpfCnpjUg: financialFilters.cpfCnpjUg,
					estado: financialFilters.estado,
					mes: financialFilters.mes,
					municipio: financialFilters.municipio,
					tipoConsulta: financialFilters.tipoConsulta,
				},
				response: exportResponse,
			})
			setExportProgress(exportAll
				? `${exportResponse.dados.length} ações exportadas de ${exportResponse.total} registros.`
				: `Página ${financialResponse.pagina} exportada; ${financialResponse.total} ações em ${financialResponse.totalPaginas} página(s) no total.`)
		} catch (exportFailure) {
			if (!controller.signal.aborted) {
				setExportError(exportFailure instanceof Error ? exportFailure.message : 'Não foi possível exportar os dados financeiros.')
				setExportProgress('')
			}
		} finally {
			if (exportController.current === controller) setExporting(false)
		}
	}
	const resultRows = response?.dados ?? []
	const currentFinancialContextKey = financialEntity ? financialContextKey(financialEntity, filters) : ''
	const currentFinancialAggregates = financialAggregates?.key === currentFinancialContextKey ? financialAggregates : null
	return financialEntity
		? <FinancialDetails
			entity={financialEntity}
			filters={filters}
			monthOptions={resources.months.items}
			page={financialPage}
			pageSize={financialPageSize}
			response={financialResponse}
			aggregateTotals={currentFinancialAggregates?.totals}
			aggregateBlocks={currentFinancialAggregates?.blocks}
			loading={financialLoading}
			error={financialError}
			retryable={financialRetryable}
			exportFormat={exportFormat}
			exportAll={exportAll}
			exporting={exporting}
			exportProgress={exportProgress}
			exportError={exportError}
			onBack={returnToResults}
			onPage={(nextPage) => void loadFinancialPage(financialEntity, nextPage, financialPageSize)}
			onPageSize={(nextPageSize) => {
				setFinancialPageSize(nextPageSize)
				setFinancialPage(1)
				void loadFinancialPage(financialEntity, 1, nextPageSize)
			}}
			onRetry={() => void loadFinancialPage(financialEntity, financialPage, financialPageSize)}
			onExportFormat={setExportFormat}
			onExportAll={setExportAll}
			onExport={() => void exportFinancialData()}
		/>
		: <div className="page-content"><div className="page-heading"><div><h2>Consulta detalhada</h2><p>Consulte repasses e entidades diretamente na API oficial do FNS.</p></div></div>
		<div className="notice notice-blue"><Search size={15} /> Os resultados desta consulta vêm diretamente do endpoint oficial do FNS. Eles não são misturados com os registros demonstrativos usados no controle de baixas.</div>
		<form className="filter-panel" onSubmit={submit}><div className="filter-grid">
			<ResourceSelect label="Ano" value={draft.year} onChange={updateYear} resource={resources.years} valueOf={(item) => item.valor} labelOf={(item) => item.descricao} placeholder="Selecione" onRetry={resources.retryYears} />
			<ResourceSelect label="Mês" value={draft.month} onChange={(v) => update('month', v)} resource={resources.months} valueOf={(item) => String(item.valor)} labelOf={(item) => item.descricao} placeholder="Todos" onRetry={resources.retryMonths} />
			<ResourceSelect label="Tipo de consulta" value={draft.queryType} onChange={(value) => setDraft((current) => ({ ...current, queryType: value, block: '' }))} resource={consultationTypeResource} valueOf={(item) => String(item.valor)} labelOf={(item) => item.descricao} placeholder="Todos" onRetry={resources.retryConsultationTypes} disabled={!draft.year} />
			<ResourceSelect label="Bloco" value={draft.block} onChange={(value) => update('block', value)} resource={resources.blocks} valueOf={(item) => item.id} labelOf={(item) => item.nome} placeholder="Todos" onRetry={resources.retryBlocks} disabled={!draft.year || !draft.queryType} />
			<Select label="Grupo" value={draft.group} onChange={(v) => update('group', v)}><option value="">Todos</option>{['Atenção Primária', 'Atenção Especializada', 'Assistência Farmacêutica', 'Vigilância em Saúde', 'Urgência e Emergência'].map((item) => <option key={item}>{item}</option>)}</Select>
			<Input label="CPF/CNPJ/UG" value={draft.document} onChange={(v) => update('document', v)} placeholder="00.000.000/0001-00" />
			<Select label="Estado" value={draft.state} onChange={(value) => setDraft((current) => ({ ...current, state: value, city: '', cityCode: '' }))}><option value="">Selecione UF</option>{states.map((state) => <option key={state.id} value={state.id}>{state.sigla} · {state.nome}</option>)}</Select>
			<MunicipalityField query={draft.city} code={draft.cityCode} selectedUf={selectedUf ?? ''} options={municipalityOptions} onQueryChange={(name) => {
				const municipality = findMunicipalityByName(partnerMunicipalityOptions, selectedUf ?? '', name)
				setDraft((current) => ({ ...current, city: name, cityCode: municipality ? getConsultationMunicipalityCode(municipality) : '' }))
			}} onSelect={(municipality) => setDraft((current) => ({ ...current, city: municipality.noMunicipio, cityCode: getConsultationMunicipalityCode(municipality) }))} />
			<Input label="Número do processo" value={draft.processNumber} onChange={(v) => update('processNumber', v)} placeholder="Número do processo" />
			<Input label="Proposta" value={draft.proposal} onChange={(v) => update('proposal', v)} placeholder="Identificador da proposta" />
			<ResourceSelect label="Tipo de repasse/recurso" value={draft.transferType} onChange={(v) => update('transferType', v)} resource={resources.transferTypes} valueOf={(item) => String(item.valor)} labelOf={(item) => item.descricao} placeholder="Todos" onRetry={resources.retryTransferTypes} />
			<Input label="Data inicial da OB" type="date" value={draft.dateFrom} onChange={(v) => update('dateFrom', v)} /><Input label="Data final da OB" type="date" value={draft.dateTo} onChange={(v) => update('dateTo', v)} />
			<Input label="Portaria" value={draft.portaria} onChange={(v) => update('portaria', v)} placeholder="Número ou descrição" />
		</div>{error && <div role="alert" className="notice notice-error" style={{ marginTop: 13 }}>{error}</div>}		<div className="filter-actions"><button className="button button-primary" type="submit" disabled={loading}><Search size={14} /> {loading ? 'Consultando entidades…' : 'Consultar'}</button><button className="button" type="button" onClick={clear}><X size={14} /> Limpar filtros</button>{response && <span style={{ color: 'var(--muted)', fontSize: 11 }}>{response.total} registro(s)</span>}</div></form>
		<section className="table-panel"><div className="table-toolbar"><strong>Resultados oficiais do FNS</strong><span>{loading ? 'Consultando o portal oficial…' : response ? `${response.total} registro(s) encontrado(s)` : 'Aplique os filtros para consultar o FNS.'}</span></div>
			{loading ? <div className="empty-state" role="status"><strong>Consultando entidades do FNS…</strong></div>
				: error && submitted ? <div className="empty-state" role="alert"><strong>Não foi possível consultar o FNS</strong><span>{error}</span>{retryable && <button className="button" type="button" onClick={() => void loadPage(filters, page)}>Tentar novamente</button>}</div>
					: !submitted ? <Empty title="Aguardando consulta" detail="Preencha os filtros e selecione Consultar." />
						: response && !resultRows.length ? <Empty title="Nenhum resultado encontrado" detail="O FNS não retornou entidades para os filtros informados." />
							: response ? <><div className="table-scroll"><table className="consultation-results-table"><thead><tr><th>Nome da entidade</th><th>UF</th><th>Município</th><th>CPF/CNPJ</th><th className="consultation-action-heading">Ação</th></tr></thead><tbody>{resultRows.map((item, index) => {
								const selectedState = states.find((state) => state.id === filters.state)
								const municipalityCode = item.codigoMunicipioIBGE
								const canUseFilterLocation = !municipalityCode || String(municipalityCode) === filters.cityCode
								const uf = item.uf ?? (canUseFilterLocation ? selectedState?.sigla : undefined)
								const municipality = item.municipio ?? (canUseFilterLocation ? filters.city : undefined)
								return <tr key={String(item.cpfCnpj ?? item.codigoMunicipioIBGE ?? index)}>
									<td className="primary-cell">{officialValue(item.razaoSocial)}</td>
									<td>{officialValue(uf)}</td>
									<td>{officialValue(municipality)}</td>
									<td>{formatConsultationDocument(item.cpfCnpj, item.cpfCnpjFormatado)}</td>
									<td className="consultation-action-cell"><div className="consultation-action-wrap"><button className="button button-icon" type="button" title="Visualizar dados financeiros" aria-label="Visualizar dados financeiros" disabled={financialLoading} onClick={() => void loadFinancialPage(item, 1)}><Eye size={15} /></button></div></td>
								</tr>
							})}</tbody></table></div><Pagination page={page} total={response.total} totalPages={response.totalPaginas} onPage={goToPage} loading={loading} /></> : null}
		</section>
	</div>
}

interface FinancialDetailsProps {
	entity: FnsFinancialEntity
	filters: ConsultationFilters
	monthOptions: MesOption[]
	page: number
	pageSize: number
	response: FnsFinancialResponse | null
	aggregateTotals?: FnsFinancialAggregateSummary['totals']
	aggregateBlocks?: FnsFinancialAggregateSummary['blocks']
	loading: boolean
	error: string
	retryable: boolean
	exportFormat: 'csv' | 'xlsx' | 'pdf'
	exportAll: boolean
	exporting: boolean
	exportProgress: string
	exportError: string
	onBack: () => void
	onPage: (page: number) => void
	onPageSize: (pageSize: number) => void
	onRetry: () => void
	onExportFormat: (format: 'csv' | 'xlsx' | 'pdf') => void
	onExportAll: (all: boolean) => void
	onExport: () => void
}

interface FinancialLaunchEditorState {
	action: FnsFinancialAction
	actionKey: string
	draft: FnsFinancialLaunchDraft
	originalDraft: FnsFinancialLaunchDraft
	saved: FnsFinancialLaunch | null
	loading: boolean
	saving: boolean
	error: string
}

function FinancialDetails(props: FinancialDetailsProps) {
	const { entity, filters, page, response, loading, error, retryable, exportFormat, exportAll, exporting, exportProgress, exportError } = props
	const { accessToken, hasSharedAccess, sharedStorageLoading, sharedStorageError } = useBackendSession()
	const { reload } = useAppData()
	const actions = response?.dados ?? EMPTY_FINANCIAL_ACTIONS
	const totals = props.aggregateTotals ?? getFinancialGeneralTotals(actions)
	const blocks = props.aggregateBlocks ?? getFinancialBlockSummary(actions)
	const municipality = officialValue(entity.municipio)
	const uf = officialValue(entity.uf)
	const location = municipality === '—' ? uf : uf === '—' ? municipality : `${municipality}/${uf}`
	const complementKey = buildFinancialComplementKey(entity, filters)
	const [savedComplement, setSavedComplement] = useState<SavedFnsFinancialComplement | null>(null)
	const [draftComplement, setDraftComplement] = useState<FnsFinancialComplement>(() => complementValues(null))
	const [complementError, setComplementError] = useState('')
	const [loadedComplementRequest, setLoadedComplementRequest] = useState('')
	const complementLoading = sharedStorageLoading || (hasSharedAccess && loadedComplementRequest !== `shared:${complementKey}`)
	const [editingComplement, setEditingComplement] = useState(false)
	const [selectedAction, setSelectedAction] = useState<FnsFinancialResponse['dados'][number] | null>(null)
	const [actionKeys, setActionKeys] = useState<Map<FnsFinancialAction, string>>(() => new Map())
	const [savedLaunches, setSavedLaunches] = useState<Map<string, FnsFinancialLaunch>>(() => new Map())
	const [editingLaunch, setEditingLaunch] = useState<FinancialLaunchEditorState | null>(null)
	const [launchStorageError, setLaunchStorageError] = useState('')
	const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(() => new Set())
	const [importing, setImporting] = useState(false)
	const [importError, setImportError] = useState('')
	const [importMessage, setImportMessage] = useState('')
	const { notify, requestConfirmation } = useFeedback()
	const closeActionDialogRef = useRef<HTMLButtonElement>(null)
	const closeLaunchDialogRef = useRef<HTMLButtonElement>(null)
	const launchOpenRequest = useRef(0)
	const launchSaveInProgress = useRef(false)
	const closeLaunchDialogHandler = useRef<() => void>(() => {})
	const closeActionDialogHandler = useRef<() => void>(() => {})
	const closeEditingLaunch = async () => {
		if (!editingLaunch) return
		if (!sameFinancialLaunchDraft(editingLaunch.draft, editingLaunch.originalDraft)) {
			const confirmed = await requestConfirmation({
				title: 'Descartar alterações pendentes?',
				description: 'Há alterações não salvas neste lançamento. Deseja descartá-las?',
				confirmLabel: 'Descartar alterações',
				icon: 'warning',
				onConfirm: () => {},
			})
			if (!confirmed) return
		}
		launchOpenRequest.current += 1
		setEditingLaunch(null)
	}
	const isDirty = !sameFinancialComplement(draftComplement, savedComplement ?? emptyFinancialComplement)
	const detailsDialogOpen = Boolean(selectedAction)
	const launchDialogOpen = Boolean(editingLaunch)

	useEffect(() => {
		let cancelled = false
		if (sharedStorageLoading) return () => { cancelled = true }
		const requestKey = `shared:${complementKey}`
		if (!hasSharedAccess) {
			void Promise.resolve().then(() => {
				if (cancelled) return
				setSavedComplement(null)
				setDraftComplement(complementValues(null))
				setComplementError(sharedStorageError || 'Os complementos só podem ser carregados quando o Supabase de desenvolvimento está conectado.')
				setLoadedComplementRequest(`unavailable:${complementKey}`)
			})
			return () => { cancelled = true }
		}
		const load = backendRequest<unknown>(`/api/data/complements?key=${encodeURIComponent(complementKey)}`, accessToken).then((rows) => {
			if (!Array.isArray(rows) || rows.length > 1) throw new Error('O backend retornou complementos em formato inválido.')
			return rows.length ? savedComplementFromRow(rows[0]) : null
		})
		void load.then((saved) => {
			if (cancelled) return
			setSavedComplement(saved)
			setDraftComplement(complementValues(saved))
			setComplementError('')
		}).catch((loadError: unknown) => {
			if (!cancelled) setComplementError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os complementos financeiros.')
		}).finally(() => {
			if (!cancelled) setLoadedComplementRequest(requestKey)
		})
		return () => { cancelled = true }
	}, [accessToken, hasSharedAccess, sharedStorageError, sharedStorageLoading, complementKey])

	useEffect(() => {
		let cancelled = false
		if (!actions.length) {
			void Promise.resolve().then(() => {
				if (cancelled) return
				setActionKeys(new Map())
				setSavedLaunches(new Map())
			})
			return () => { cancelled = true }
		}
		const loadLaunches = async () => {
			const keys = await Promise.all(actions.map(async (action) => ({
				action,
				key: await createFnsFinancialActionKey(entity, filters, action),
			})))
			if (sharedStorageLoading) return
			if (!hasSharedAccess) {
				if (cancelled) return
				setActionKeys(new Map(keys.map(({ action, key }) => [action, key])))
				setSavedLaunches(new Map())
				setLaunchStorageError(sharedStorageError || 'Os lançamentos só podem ser carregados quando o Supabase de desenvolvimento está conectado.')
				return
			}
			const remote = await Promise.all(keys.map(async ({ key }) => [key, await loadRemoteLaunch(key, accessToken)] as const))
			const savedByKey = new Map(remote.flatMap(([key, launch]) => launch ? [[key, launch] as const] : []))
			if (cancelled) return
			setActionKeys(new Map(keys.map(({ action, key }) => [action, key])))
			setSavedLaunches(new Map(keys.flatMap(({ key }) => {
				const launch = savedByKey.get(key)
				return launch ? [[key, launch] as const] : []
			})))
		}
		void loadLaunches().catch((loadError: unknown) => {
			if (!cancelled) {
				setLaunchStorageError(loadError instanceof Error ? loadError.message : 'Não foi possível consultar os rascunhos financeiros.')
			}
		})
		return () => { cancelled = true }
	}, [accessToken, hasSharedAccess, sharedStorageError, sharedStorageLoading, actions, entity, filters])

	useEffect(() => {
		closeLaunchDialogHandler.current = () => { void closeEditingLaunch() }
		closeActionDialogHandler.current = () => setSelectedAction(null)
	})

	useEffect(() => {
		if (!editingComplement || !isDirty) return
		const warnBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault()
			event.returnValue = ''
		}
		window.addEventListener('beforeunload', warnBeforeUnload)
		return () => window.removeEventListener('beforeunload', warnBeforeUnload)
	}, [editingComplement, isDirty])

	useEffect(() => {
		if (!detailsDialogOpen && !launchDialogOpen) return
		const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		;(launchDialogOpen ? closeLaunchDialogRef : closeActionDialogRef).current?.focus()
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault()
				if (launchDialogOpen) closeLaunchDialogHandler.current()
				else closeActionDialogHandler.current()
				return
			}
			if (event.key !== 'Tab') return
			const dialog = document.querySelector<HTMLElement>('.financial-action-dialog')
			const focusable = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
			if (!focusable?.length) return
			const first = focusable[0]
			const last = focusable[focusable.length - 1]
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault()
				last.focus()
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault()
				first.focus()
			}
		}
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('keydown', onKeyDown)
			document.body.style.overflow = previousOverflow
			previouslyFocused?.focus()
		}
	}, [detailsDialogOpen, launchDialogOpen])

	const updateComplement = <K extends keyof FnsFinancialComplement>(key: K, value: FnsFinancialComplement[K]) => {
		setDraftComplement((current) => ({ ...current, [key]: value }))
	}
	const cancelComplementEdit = () => {
		setDraftComplement(complementValues(savedComplement))
		setEditingComplement(false)
	}
	const saveComplement = async () => {
		if (!hasSharedAccess) {
			notify('error', 'Os complementos não foram salvos: o Supabase de desenvolvimento não está conectado.')
			return
		}
		try {
			const persisted = await backendRequest<unknown>('/api/data/complements', accessToken, {
				method: 'POST',
				body: {
					action_key: complementKey,
					observations: draftComplement.observations,
					review_status: draftComplement.reviewStatus,
					review_responsible: draftComplement.reviewResponsible.trim(),
					internal_reference: draftComplement.internalReference.trim(),
					legacy_updated_at: new Date().toISOString(),
				},
			})
			if (!Array.isArray(persisted) || persisted.length !== 1) throw new Error('Os complementos não foram confirmados pelo banco de dados.')
			const saved = savedComplementFromRow(persisted[0])
			setSavedComplement(saved)
			setDraftComplement(complementValues(saved))
			setEditingComplement(false)
			notify('success', 'Complementos salvos no Supabase. Nenhum dado foi enviado ao FNS.')
		} catch (saveError) {
			notify('error', saveError instanceof Error ? saveError.message : 'Não foi possível salvar os complementos no Supabase.')
		}
	}
	const openFinancialLaunch = async (action: FnsFinancialAction) => {
		if (!hasSharedAccess || sharedStorageLoading) {
			setLaunchStorageError(sharedStorageError || 'Os lançamentos só podem ser editados quando o Supabase de desenvolvimento está conectado.')
			return
		}
		const requestId = ++launchOpenRequest.current
		const initialDraft = emptyFnsFinancialLaunchDraft()
		setSelectedAction(null)
		setEditingLaunch({
			action,
			actionKey: '',
			draft: initialDraft,
			originalDraft: initialDraft,
			saved: null,
			loading: true,
			saving: false,
			error: '',
		})
		try {
			const actionKey = await createFnsFinancialActionKey(entity, filters, action)
			const saved = savedLaunches.get(actionKey) ?? await loadRemoteLaunch(actionKey, accessToken)
			if (launchOpenRequest.current !== requestId) return
			setLaunchStorageError('')
			const draft = saved
				? financialLaunchToDraft(saved)
				: emptyFnsFinancialLaunchDraft(amountFromOfficialValue(action.valorLiquido))
			draft.date = getFnsFinancialLaunchDate(draft.date)
			setEditingLaunch({ action, actionKey, draft, originalDraft: { ...draft }, saved, loading: false, saving: false, error: '' })
			setSavedLaunches((current) => {
				const next = new Map(current)
				if (saved) next.set(actionKey, saved)
				else next.delete(actionKey)
				return next
			})
		} catch (loadError) {
			if (launchOpenRequest.current === requestId) {
				setEditingLaunch((current) => current ? {
					...current,
					loading: false,
					error: loadError instanceof Error ? loadError.message : 'Não foi possível carregar o rascunho do Supabase.',
				} : current)
			}
		}
	}
	const updateLaunchDraft = <K extends keyof FnsFinancialLaunchDraft>(key: K, value: FnsFinancialLaunchDraft[K]) => {
		setEditingLaunch((current) => current ? { ...current, draft: { ...current.draft, [key]: value }, error: '' } : current)
	}
	const importSelected = async () => {
		if (!hasSharedAccess || selectedImportIds.size === 0 || !filters.year) return
		const municipality = getActivePartnerMunicipality(filters.cityCode)
		const document = String(entity.cpfCnpjFormatado ?? entity.cpfCnpj ?? '').replace(/\D/g, '')
		if (!municipality || ![11, 14].includes(document.length)) {
			setImportError('Não foi possível validar o CNPJ/CPF e o município parceiro para importar estes registros.')
			return
		}
		setImporting(true)
		setImportError('')
		setImportMessage('')
		try {
			const result = await backendRequest<{ importId: string; found: number; imported: number; updated: number; ignored: number }>(
				'/api/fns/import',
				accessToken,
				{
					method: 'POST',
					body: {
						filters: {
							ano: filters.year,
							mes: filters.month,
							tipoConsulta: filters.queryType,
							estado: municipality.uf,
							municipio: municipality.ibgeCode,
							cpfCnpjUg: document,
						},
						selectedIds: [...selectedImportIds],
					},
				},
			)
			setImportMessage(`${result.imported} importado(s), ${result.updated} atualizado(s), ${result.ignored} não encontrado(s) na conferência atual do FNS.`)
			setSelectedImportIds(new Set())
			window.dispatchEvent(new Event('mck-fns-data-updated'))
			try {
				await reload()
			} catch (refreshError) {
				setImportError(`A importação foi confirmada no Supabase, mas os dados do Dashboard não puderam ser atualizados: ${refreshError instanceof Error ? refreshError.message : 'falha ao recarregar os dados.'}`)
			}
		} catch (saveError) {
			setImportError(saveError instanceof BackendApiError
				? saveError.message
				: saveError instanceof Error ? saveError.message : 'A importação não foi concluída.')
		} finally {
			setImporting(false)
		}
	}
	const saveFinancialLaunch = async () => {
		if (!editingLaunch || editingLaunch.loading || editingLaunch.saving || launchSaveInProgress.current || !editingLaunch.actionKey) return
		if (!hasSharedAccess) {
			setEditingLaunch((current) => current ? { ...current, error: 'O lançamento não foi salvo: o Supabase de desenvolvimento não está conectado.' } : current)
			return
		}
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
			const draft = { ...editingLaunch.draft, amount: amount.toFixed(2) }
			const repasseId = await findImportedRepasseId(editingLaunch.action, entity, filters, accessToken)
			if (!repasseId) {
				throw new Error('Importe este repasse oficial para o Supabase antes de lançar as finanças.')
			}
			const now = new Date().toISOString()
			const payload = {
				action_key: editingLaunch.actionKey,
				repasse_id: repasseId,
				status: draft.status,
				amount,
				launch_date: draft.date || null,
				document_number: draft.documentNumber,
				account_reference: draft.accountReference,
				responsible: draft.responsible,
				observations: draft.observations,
				legacy_created_at: editingLaunch.saved?.createdAt ?? now,
				legacy_updated_at: now,
			}
			const result = await backendRequest<unknown>(
				editingLaunch.saved
					? `/api/data/launches/${encodeURIComponent(editingLaunch.actionKey)}`
					: '/api/data/launches',
				accessToken,
				{ method: editingLaunch.saved ? 'PATCH' : 'POST', body: payload },
			)
			if (!Array.isArray(result) || result.length !== 1) throw new Error('O rascunho não foi confirmado pelo banco de dados.')
			const saved = launchFromRow(result[0])
			const normalizedDraft = financialLaunchToDraft(saved)
			setSavedLaunches((current) => new Map(current).set(saved.actionKey, saved))
			setEditingLaunch((current) => current ? {
				...current,
				draft: normalizedDraft,
				originalDraft: { ...normalizedDraft },
				saved,
				error: '',
			} : current)
			notify('success', 'Lançamento financeiro confirmado no Supabase. Nenhum dado oficial do FNS foi alterado.')
			window.dispatchEvent(new Event('mck-fns-data-updated'))
		} catch (saveError) {
			setEditingLaunch((current) => current ? {
				...current,
				error: saveError instanceof Error ? saveError.message : 'Não foi possível salvar o rascunho financeiro no Supabase.',
			} : current)
		} finally {
			launchSaveInProgress.current = false
			setEditingLaunch((current) => current ? { ...current, saving: false } : current)
		}
	}
	const returnToResults = async () => {
		if (editingComplement && isDirty) {
			const confirmed = await requestConfirmation({
				title: 'Descartar alterações pendentes?',
				description: 'Há alterações locais não salvas. Deseja descartá-las e voltar aos resultados?',
				confirmLabel: 'Descartar e voltar',
				icon: 'warning',
				onConfirm: () => {},
			})
			if (!confirmed) return
		}
		props.onBack()
	}
	const hasSavedLaunch = (action: FnsFinancialAction) => {
		const actionKey = actionKeys.get(action)
		return Boolean(actionKey && savedLaunches.has(actionKey))
	}
	return <div className="page-content">
		<div className="page-heading"><div><h2>Dados financeiros do FNS</h2><p>{officialValue(entity.razaoSocial)}</p></div><div className="financial-heading-actions">
			{editingComplement
				? <><button className="button button-primary" type="submit" form="financial-complement-form" disabled={!hasSharedAccess || !isDirty || complementLoading}><Save size={14} /> Salvar alterações</button><button className="button" type="button" onClick={cancelComplementEdit}><X size={14} /> Cancelar</button></>
				: <button className="button" type="button" disabled={!hasSharedAccess || complementLoading} onClick={() => setEditingComplement(true)}><Pencil size={14} /> Editar</button>}
			<button className="button" type="button" onClick={returnToResults}><ArrowLeft size={14} /> Voltar para resultados</button>
		</div></div>
		<div className="notice notice-blue"><Search size={15} /> Dados financeiros consultados diretamente na API oficial do FNS.</div>
		<section className="financial-identity">
			<div><strong>Entidade</strong><span>{officialValue(entity.razaoSocial)}</span></div>
			<div><strong>CNPJ</strong><span>{officialValue(entity.cpfCnpjFormatado ?? entity.cpfCnpj)}</span></div>
			<div><strong>Município/UF</strong><span>{location}</span></div>
			<div><strong>Ano e mês de referência</strong><span>{[officialValue(filters.year), formatConsultationMonth(filters.month, props.monthOptions)].filter((value) => value !== '—').join(' · ') || '—'}</span></div>
			<div><strong>Tipo de consulta</strong><span>{officialValue(filters.queryType)}</span></div>
		</section>
		<section className="financial-complement-panel" aria-labelledby="financial-complement-title">
			<div className="financial-complement-heading"><div><h3 id="financial-complement-title">Complementos internos</h3><span>Informações internas, separadas dos dados oficiais do FNS.</span></div>{hasSharedAccess && savedComplement && !editingComplement && <span className="financial-local-saved">Salvo no Supabase em {new Date(savedComplement.updatedAt).toLocaleString('pt-BR')}</span>}</div>
			{complementLoading && <p role="status">Carregando complementos…</p>}
			{complementError && <p className="financial-complement-error" role="alert">{complementError}</p>}
			{editingComplement
				? <form id="financial-complement-form" className="financial-complement-grid" onSubmit={(event) => { event.preventDefault(); saveComplement() }}>
					<label className="financial-complement-field financial-complement-wide">Observações internas<textarea value={draftComplement.observations} maxLength={2000} rows={4} aria-describedby="financial-observations-hint" onChange={(event) => updateComplement('observations', event.target.value)} placeholder="Registre observações internas da conferência" /><span id="financial-observations-hint" className="field-hint">{draftComplement.observations.length}/2.000 caracteres</span></label>
					<label className="financial-complement-field">Situação da conferência<select value={draftComplement.reviewStatus} onChange={(event) => updateComplement('reviewStatus', event.target.value as FnsFinancialComplement['reviewStatus'])}><option value="">Não informada</option><option value="Não iniciada">Não iniciada</option><option value="Em conferência">Em conferência</option><option value="Conferida">Conferida</option><option value="Pendente de esclarecimento">Pendente de esclarecimento</option></select></label>
					<label className="financial-complement-field">Responsável pela conferência<input value={draftComplement.reviewResponsible} maxLength={120} onChange={(event) => updateComplement('reviewResponsible', event.target.value)} placeholder="Nome do responsável" /></label>
					<label className="financial-complement-field">Protocolo ou referência interna<input value={draftComplement.internalReference} maxLength={80} onChange={(event) => updateComplement('internalReference', event.target.value)} placeholder="Identificador interno (opcional)" /></label>
					{isDirty && <span className="financial-complement-pending" role="status">Há alterações pendentes de salvamento.</span>}
				</form>
				: <div className="financial-complement-grid">
					{savedComplement?.observations.trim() && <div className="financial-complement-value financial-complement-wide"><strong>Observações internas</strong><span>{savedComplement.observations}</span></div>}
					{savedComplement?.reviewStatus && <div className="financial-complement-value"><strong>Situação da conferência</strong><span>{savedComplement.reviewStatus}</span></div>}
					{savedComplement?.reviewResponsible.trim() && <div className="financial-complement-value"><strong>Responsável pela conferência</strong><span>{savedComplement.reviewResponsible}</span></div>}
					{savedComplement?.internalReference.trim() && <div className="financial-complement-value"><strong>Protocolo ou referência interna</strong><span>{savedComplement.internalReference}</span></div>}
					{!complementLoading && !complementError && (!savedComplement
						|| (!savedComplement.observations.trim() && !savedComplement.reviewStatus
							&& !savedComplement.reviewResponsible.trim() && !savedComplement.internalReference.trim()))
						&& <p className="financial-complement-empty">Nenhum complemento interno registrado.</p>}
				</div>}
			{editingComplement && <p className="financial-local-disclaimer">As alterações serão salvas no Supabase e não alteram nem substituem informações oficiais.</p>}
			<MunicipalLeadership ibgeCode={filters.cityCode} />
		</section>
		{loading ? <div className="empty-state" role="status"><strong>Consultando dados financeiros do FNS…</strong></div>
			: error ? <div className="empty-state" role="alert"><strong>Não foi possível carregar os dados financeiros</strong><span>{error}</span>{retryable && <button className="button" type="button" onClick={props.onRetry}>Tentar novamente</button>}</div>
				: response ? <>
					{[totals.total, totals.discounts, totals.net].some((value) => value !== undefined) && <section className="table-panel financial-general-totals" aria-labelledby="financial-general-totals-title">
						<div className="table-toolbar"><strong id="financial-general-totals-title">Totais gerais da consulta</strong></div>
						<div className="financial-metrics">
							{totals.total !== undefined && <Metric label="Valor total geral" value={formatMoney(totals.total)} />}
							{totals.discounts !== undefined && <Metric label="Descontos gerais" value={formatMoney(totals.discounts)} />}
							{totals.net !== undefined && <Metric label="Valor líquido geral" value={formatMoney(totals.net)} />}
						</div>
					</section>}
					<section className="table-panel">
						<div className="table-toolbar"><strong>Ações financeiras</strong><span>{response.total > 0 ? `${response.total} ação(ões) no total · página ${response.pagina} de ${response.totalPaginas}` : 'Nenhuma ação válida retornada pelo FNS'}</span>{selectedImportIds.size > 0 && <button className="button button-primary" type="button" disabled={!hasSharedAccess || sharedStorageLoading || importing || selectedImportIds.size > 100} onClick={() => void importSelected()}>{importing ? 'Gravando no Supabase…' : `Importar ${selectedImportIds.size} selecionado(s)`}</button>}</div>
						{!hasSharedAccess && <div className="notice notice-amber">{sharedStorageError || 'Configure o modo de teste no backend para importar os registros selecionados para o Supabase.'}</div>}
						{importMessage && <div className="notice" role="status">{importMessage}</div>}
						{importError && <div className="notice notice-error" role="alert">{importError}</div>}
						{launchStorageError && <p className="financial-launch-error" role="alert">{launchStorageError}</p>}
						{actions.length === 0 ? <Empty title="Nenhuma ação financeira encontrada" detail="O FNS não retornou ações para esta entidade e estes filtros." />
							: <div className="table-scroll"><table className="financial-actions-table"><thead><tr><th>Importar</th><th>Descrição da ação</th><th>Forma de repasse</th><th>Parcelas</th><th className="numeric-cell">Valor total</th><th className="numeric-cell">Descontos</th><th className="numeric-cell">Valor líquido</th><th className="financial-action-heading">Ação</th></tr></thead><tbody>{actions.map((action, index) => {
								const actionId = typeof action.id === 'number' || typeof action.id === 'string' ? String(action.id).trim() : ''
								const stableActionId = actionId && actionId !== '0' ? actionId : ''
								return <tr className={hasSavedLaunch(action) ? 'financial-action-saved-row' : undefined} key={String(action.id ?? `${response.pagina}-${index}`)}>
								<td><input type="checkbox" aria-label={`Selecionar para importar ${officialValue(action.descricao)}`} disabled={!stableActionId || !hasSharedAccess || sharedStorageLoading || importing} checked={stableActionId ? selectedImportIds.has(stableActionId) : false} onChange={(event) => setSelectedImportIds((current) => { const next = new Set(current); if (event.target.checked) next.add(stableActionId); else next.delete(stableActionId); return next })} /></td>
								<td>{officialValue(action.descricao)}</td><td>{officialValue(action.formaRepasse)}</td><td>{officialValue(action.quantidadeParcelas)}</td>
								<td className="numeric-cell">{moneyValue(action.valorTotal)}</td><td className="numeric-cell">{moneyValue(action.valorDescontoTotal)}</td><td className="numeric-cell">{moneyValue(action.valorLiquido)}</td>
								<td className="financial-action-cell"><div className="financial-action-buttons">
									<button className="button button-icon financial-action-view" type="button" title="Visualizar detalhes" aria-label={`Visualizar detalhes ${officialValue(action.descricao)}`} onClick={() => { setEditingLaunch(null); setSelectedAction(action) }}><Eye size={15} /></button>
									<button className="button button-icon financial-action-view" type="button" title="Editar lançamento financeiro" aria-label={`Editar lançamento financeiro ${officialValue(action.descricao)}`} disabled={!hasSharedAccess || sharedStorageLoading} onClick={() => void openFinancialLaunch(action)}><Pencil size={15} /></button>
									{hasSavedLaunch(action) && <span className="financial-launch-saved" title="Rascunho salvo" aria-label="Rascunho salvo"><Check size={12} aria-hidden="true" /> Rascunho salvo</span>}
								</div></td>
							</tr>})}</tbody></table></div>}
						{response.total > 0 && <Pagination page={page} total={response.total} totalPages={response.totalPaginas} pageSize={props.pageSize} pageSizes={[10, 25, 50]} onPage={props.onPage} onPageSize={props.onPageSize} loading={loading} />}
					</section>
					{selectedAction && <div className="financial-action-dialog-overlay" onMouseDown={(event) => {
						if (event.target === event.currentTarget) setSelectedAction(null)
					}}>
						<section className="financial-action-dialog" role="dialog" aria-modal="true" aria-labelledby="financial-action-dialog-title">
							<header className="financial-action-dialog-header"><div><h2 id="financial-action-dialog-title">Detalhes da ação financeira</h2><p>{officialValue(selectedAction.descricao)}</p></div><button ref={closeActionDialogRef} className="financial-action-dialog-close" type="button" aria-label="Fechar detalhes" onClick={() => setSelectedAction(null)}><X size={19} /></button></header>
							<div className="financial-action-dialog-content">
								{(() => {
									const details = getFnsFinancialActionDetails(selectedAction)
									const general = details.filter(({ isFinancial }) => !isFinancial)
									const financial = details.filter(({ isFinancial }) => isFinancial)
									return <>
										<section className="financial-action-detail-section"><h3>Dados da ação</h3><div className="financial-action-detail-grid">{general.map(({ key, label, value }) => <div className="financial-action-detail-card" key={key}><strong>{label}</strong><span>{formatFnsFinancialActionDetail(value, false)}</span></div>)}</div></section>
										{financial.length > 0 && <section className="financial-action-detail-section"><h3>Valores da ação selecionada</h3><div className="financial-action-detail-grid">{financial.map(({ key, label, value }) => <div className="financial-action-detail-card" key={key}><strong>{label}</strong><span>{formatFnsFinancialActionDetail(value, true)}</span></div>)}</div></section>}
									</>
								})()}
							</div>
							<footer className="financial-action-dialog-footer"><button className="button" type="button" onClick={() => setSelectedAction(null)}>Fechar</button></footer>
						</section>
					</div>}
					{editingLaunch && <div className="financial-action-dialog-overlay financial-launch-overlay" onMouseDown={(event) => {
						if (event.target === event.currentTarget) void closeEditingLaunch()
					}}>
						<section className="financial-action-dialog financial-launch-dialog" role="dialog" aria-modal="true" aria-labelledby="financial-launch-dialog-title">
							<header className="financial-action-dialog-header"><div><h2 id="financial-launch-dialog-title">Editar lançamento financeiro</h2><p>{officialValue(editingLaunch.action.descricao)}</p></div><button ref={closeLaunchDialogRef} className="financial-action-dialog-close" type="button" aria-label="Fechar edição do lançamento" onClick={() => void closeEditingLaunch()}><X size={19} /></button></header>
							<form className="financial-launch-form" onSubmit={(event) => { event.preventDefault(); void saveFinancialLaunch() }}>
								<div className="financial-action-dialog-content financial-launch-content">
									{editingLaunch.loading
										? <p className="financial-launch-status" role="status">Carregando dados salvos…</p>
										: <>
											<section className="financial-action-detail-section financial-launch-official">
												<h3>Dados oficiais do FNS — somente leitura</h3>
												<div className="financial-launch-readonly-grid">
													<ReadonlyFinancialField label="Entidade" value={officialValue(entity.razaoSocial)} />
													<ReadonlyFinancialField label="Município/UF" value={location} />
													<ReadonlyFinancialField label="Ano" value={officialValue(filters.year)} />
													<ReadonlyFinancialField label="Mês" value={formatConsultationMonth(filters.month, props.monthOptions)} />
													<ReadonlyFinancialField label="Descrição da ação" value={officialValue(editingLaunch.action.descricao)} wide />
													<ReadonlyFinancialField label="Forma de repasse" value={officialValue(editingLaunch.action.formaRepasse)} />
													<ReadonlyFinancialField label="Quantidade de parcelas" value={officialValue(editingLaunch.action.quantidadeParcelas)} />
													<ReadonlyFinancialField label="Valor total" value={moneyValue(editingLaunch.action.valorTotal)} />
													<ReadonlyFinancialField label="Descontos" value={moneyValue(editingLaunch.action.valorDescontoTotal)} />
													<ReadonlyFinancialField label="Valor líquido" value={moneyValue(editingLaunch.action.valorLiquido)} />
												</div>
											</section>
											<section className="financial-action-detail-section financial-launch-internal">
												<h3>Dados internos do lançamento</h3>
												<div className="financial-launch-form-grid">
													<label className="financial-launch-field">Situação do lançamento
														<select value={editingLaunch.draft.status} onChange={(event) => updateLaunchDraft('status', event.target.value as FnsFinancialLaunchDraft['status'])}>
															<option>Pendente</option><option>Em análise</option><option>Conferido</option><option>Lançado</option>
														</select>
													</label>
													<label className="financial-launch-field">Valor lançado (R$)
														<input type="text" inputMode="decimal" value={editingLaunch.draft.amount} aria-invalid={Boolean(editingLaunch.error && parseFnsFinancialLaunchAmount(editingLaunch.draft.amount) === undefined)} onChange={(event) => updateLaunchDraft('amount', event.target.value)} placeholder="0,00" />
													</label>
													<label className="financial-launch-field">Data do lançamento
														<input type="date" value={editingLaunch.draft.date} aria-invalid={Boolean(editingLaunch.error && !isValidFnsFinancialLaunchDate(editingLaunch.draft.date))} onChange={(event) => updateLaunchDraft('date', event.target.value)} />
													</label>
													<label className="financial-launch-field">Número do documento
														<input type="text" maxLength={120} value={editingLaunch.draft.documentNumber} onChange={(event) => updateLaunchDraft('documentNumber', event.target.value)} />
													</label>
													<label className="financial-launch-field">Conta ou referência financeira
														<input type="text" maxLength={160} value={editingLaunch.draft.accountReference} onChange={(event) => updateLaunchDraft('accountReference', event.target.value)} />
													</label>
													<label className="financial-launch-field">Responsável pelo lançamento
														<input type="text" maxLength={120} value={editingLaunch.draft.responsible} onChange={(event) => updateLaunchDraft('responsible', event.target.value)} />
													</label>
													<label className="financial-launch-field financial-launch-wide">Observações
														<textarea rows={4} maxLength={2000} value={editingLaunch.draft.observations} onChange={(event) => updateLaunchDraft('observations', event.target.value)} />
													</label>
												</div>
											</section>
											<p className="financial-launch-disclaimer">Os dados internos são salvos no Supabase e não alteram os dados oficiais do FNS. Evite incluir dados pessoais sensíveis, senhas ou credenciais.</p>
											{editingLaunch.error && <p className="financial-launch-error" role="alert">{editingLaunch.error}</p>}
										</>}
								</div>
								<footer className="financial-action-dialog-footer financial-launch-footer">
									<button className="button" type="button" onClick={() => void closeEditingLaunch()}>Cancelar</button>
									<button className="button button-primary" type="submit" disabled={!hasSharedAccess || editingLaunch.loading || editingLaunch.saving || !editingLaunch.actionKey}><Save size={14} /> {editingLaunch.saving ? 'Lançando…' : 'Lançar finanças'}</button>
								</footer>
							</form>
						</section>
					</div>}
					{blocks.length > 0 && <section className="table-panel financial-block-totals"><div className="table-toolbar"><strong>Totais por bloco</strong><span>Agregados informados pelo FNS; não são somados novamente aos totais gerais</span></div><div className="table-scroll"><table><thead><tr><th>Bloco</th><th>Grupo</th><th className="numeric-cell">Valor total</th><th className="numeric-cell">Descontos</th><th className="numeric-cell">Valor líquido</th></tr></thead><tbody>{blocks.map((block, index) => <tr key={String(block.id ?? `${block.nome ?? 'bloco'}-${index}`)}><td>{nestedValue(block.nome)}</td><td>{nestedValue(block.grupo)}</td><td className="numeric-cell">{moneyValue(block.valorTotal)}</td><td className="numeric-cell">{moneyValue(block.valorDescontoTotal)}</td><td className="numeric-cell">{moneyValue(block.valorLiquido)}</td></tr>)}</tbody></table></div></section>}
					<section className="financial-export">
						<label>Formato <select value={exportFormat} onChange={(event) => props.onExportFormat(event.target.value as 'csv' | 'xlsx' | 'pdf')}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option><option value="pdf">PDF (.pdf)</option></select></label>
						<label className="financial-export-all"><input type="checkbox" checked={exportAll} onChange={(event) => props.onExportAll(event.target.checked)} disabled={exporting} /> Exportar todos os registros ({response.total})</label>
						<button className="button button-primary" type="button" onClick={props.onExport} disabled={exporting || actions.length === 0}><Download size={14} /> {exporting ? 'Preparando…' : 'Exportar'}</button>
						{exportProgress && <span role="status">{exportProgress}</span>}
						{exportError && <span className="financial-export-error" role="alert">{exportError}</span>}
					</section>
					{!exportAll && response.totalPaginas > 1 && <p className="financial-export-note">A exportação inclui somente a página carregada. Selecione “Exportar todos os registros” para buscar todas as páginas antes de gerar o arquivo.</p>}
				</> : null}
	</div>
}

function MunicipalLeadership({ ibgeCode }: { ibgeCode: string }) {
	const [attempt, setAttempt] = useState(0)
	const [state, setState] = useState<{
		ibgeCode: string
		attempt: number
		loading: boolean
		leadership: FnsMunicipalLeadership | null
		error: string
	}>(() => ({ ibgeCode, attempt: 0, loading: true, leadership: null, error: '' }))

	useEffect(() => {
		const controller = new AbortController()
		getFnsMunicipalLeadership(ibgeCode, controller.signal).then(({ resultado }) => {
			if (!controller.signal.aborted) setState({ ibgeCode, attempt, loading: false, leadership: resultado, error: '' })
		}).catch((error: unknown) => {
			if (!controller.signal.aborted) {
				setState({
					ibgeCode,
					attempt,
					loading: false,
					leadership: null,
					error: error instanceof Error ? error.message : 'Não foi possível consultar os responsáveis do município no FNS.',
				})
			}
		})
		return () => controller.abort()
	}, [ibgeCode, attempt])

	const isCurrent = state.ibgeCode === ibgeCode && state.attempt === attempt
	const loading = !isCurrent || state.loading
	const error = isCurrent ? state.error : ''
	const leadership = isCurrent ? state.leadership : null
	const mandateTimestamp = typeof leadership?.inicioMandato === 'number'
		? new Date(leadership.inicioMandato)
		: null
	const startDate = leadership?.inicioMandatoFormatado
		|| (mandateTimestamp && !Number.isNaN(mandateTimestamp.getTime())
			? mandateTimestamp.toLocaleDateString('pt-BR')
			: '')

	return <section className="financial-leadership" aria-labelledby="municipal-leadership-title">
		<div className="financial-complement-heading">
			<div><h3 id="municipal-leadership-title"><UsersRound size={15} /> Responsáveis do Município</h3><span>Dados oficiais consultados no FNS para o município selecionado.</span></div>
		</div>
		{loading
			? <p className="financial-leadership-status" role="status">Carregando responsáveis do município…</p>
			: error
				? <div className="financial-leadership-error" role="alert"><span>{error}</span><button className="retry-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</button></div>
				: !leadership
					? <p className="financial-leadership-status">Dados dos responsáveis não disponíveis para este município.</p>
					: (() => {
						const values = [
							{ label: 'Prefeito(a)', value: leadership.nome },
							{ label: 'Cargo', value: leadership.cargo },
							{ label: 'Início do mandato', value: startDate },
							{ label: 'Secretário(a) de Saúde', value: leadership.noSecretario },
							{ label: 'Presidente do Conselho de Saúde', value: leadership.noPresidenteConselho },
						].filter(({ value }) => Boolean(value?.trim()))
						return values.length
							? <div className="financial-leadership-grid">{values.map(({ label, value }) => <LeadershipValue key={label} label={label} value={value} />)}</div>
							: <p className="financial-leadership-status">Dados dos responsáveis não disponíveis para este município.</p>
					})()}
	</section>
}

function LeadershipValue({ label, value }: { label: string; value: string | undefined }) {
	return <div className="financial-leadership-value"><strong>{label}</strong><span>{value}</span></div>
}

function buildFinancialComplementKey(entity: FnsFinancialEntity, filters: ConsultationFilters): string {
	const document = String(entity.cpfCnpj ?? '').replace(/\D/g, '')
	return JSON.stringify([
		document,
		String(entity.codigoMunicipioIBGE ?? ''),
		String(entity.uf ?? ''),
		filters.year,
		filters.month,
		filters.queryType,
	])
}

function complementValues(saved: SavedFnsFinancialComplement | null): FnsFinancialComplement {
	if (!saved) return { ...emptyFinancialComplement }
	return {
		observations: saved.observations,
		reviewStatus: saved.reviewStatus,
		reviewResponsible: saved.reviewResponsible,
		internalReference: saved.internalReference,
	}
}

function sameFinancialComplement(left: FnsFinancialComplement, right: FnsFinancialComplement): boolean {
	return left.observations === right.observations
		&& left.reviewStatus === right.reviewStatus
		&& left.reviewResponsible === right.reviewResponsible
		&& left.internalReference === right.internalReference
}

function Metric({ label, value }: { label: string; value: string }) {
	return <div className="financial-metric"><span>{label}</span><strong>{value}</strong></div>
}

function ReadonlyFinancialField({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
	return <div className={`financial-launch-readonly${wide ? ' financial-launch-wide' : ''}`}><strong>{label}</strong><span>{value}</span></div>
}

function financialLaunchToDraft(launch: FnsFinancialLaunch): FnsFinancialLaunchDraft {
	const amount = parseFnsFinancialLaunchAmount(launch.amount)
	return {
		status: launch.status,
		amount: amount === undefined ? launch.amount : formatFnsFinancialLaunchAmount(amount),
		date: launch.date,
		documentNumber: launch.documentNumber,
		accountReference: launch.accountReference,
		responsible: launch.responsible,
		observations: launch.observations,
	}
}

function amountFromOfficialValue(value: unknown): string {
	const amount = typeof value === 'number'
		? value
		: typeof value === 'string' ? parseFnsFinancialLaunchAmount(value) : undefined
	return amount !== undefined && amount >= 0 ? formatFnsFinancialLaunchAmount(amount) : ''
}

function sameFinancialLaunchDraft(left: FnsFinancialLaunchDraft, right: FnsFinancialLaunchDraft): boolean {
	return left.status === right.status
		&& left.amount === right.amount
		&& left.date === right.date
		&& left.documentNumber === right.documentNumber
		&& left.accountReference === right.accountReference
		&& left.responsible === right.responsible
		&& left.observations === right.observations
}

function moneyValue(value: unknown): string {
	if (typeof value === 'number' && Number.isFinite(value)) return formatMoney(value)
	if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return formatMoney(Number(value))
	return officialValue(value)
}

function nestedValue(value: unknown): string {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return officialValue(value)
	const record = value as Record<string, unknown>
	return officialValue(record.nome ?? record.descricao)
}

function formatMoney(value: number): string {
	return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function officialValue(value: unknown): string {
	if (value === null || value === undefined || value === '') return '—'
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
	return JSON.stringify(value)
}

function formatConsultationDocument(document: unknown, formattedDocument: unknown): string {
	if (typeof formattedDocument === 'string' && formattedDocument.trim()) return formattedDocument
	if (typeof document !== 'string' && typeof document !== 'number') return officialValue(document)
	const value = String(document)
	const digits = value.replace(/\D/g, '')
	if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
	if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
	return officialValue(document)
}

function Input({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) { const id = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'); return <div className="field"><label htmlFor={id}>{label}</label><input id={id} type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></div> }
function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) { const id = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'); return <div className="field"><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></div> }
function ResourceSelect<T>({ label, value, onChange, resource, valueOf, labelOf, placeholder, onRetry, disabled = false }: { label: string; value: string; onChange: (value: string) => void; resource: ResourceState<T>; valueOf: (item: T) => string; labelOf: (item: T) => string; placeholder: string; onRetry: () => void; disabled?: boolean }) {
	const id = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')
	const statusId = `${id}-status`
	return <div className="field"><label htmlFor={id}>{label}</label><select id={id} value={value} disabled={disabled || resource.loading || (Boolean(resource.error) && !resource.stale)} aria-describedby={resource.loading || resource.error ? statusId : undefined} onChange={(event) => onChange(event.target.value)}><option value="">{placeholder}</option>{resource.items.map((item) => <option key={valueOf(item)} value={valueOf(item)}>{labelOf(item)}</option>)}{!resource.loading && !resource.error && resource.items.length === 0 && <option disabled>Nenhuma opção retornada</option>}</select>{resource.loading && <span id={statusId} className="field-hint" role="status">Carregando opções do portal FNS…{resource.stale && ' Mantendo opções armazenadas anteriormente.'}</span>}{resource.error && <div id={statusId} className="resource-error"><span role="alert">{resource.error}{resource.stale && ' Exibindo dados armazenados anteriormente.'}</span>{resource.retryable && <button className="retry-button" type="button" onClick={onRetry}>Tentar novamente</button>}</div>}</div>
}
function MunicipalityField({ query, code, selectedUf, options, onQueryChange, onSelect }: { query: string; code: string; selectedUf: string; options: MunicipioOption[]; onQueryChange: (name: string) => void; onSelect: (municipality: MunicipioOption) => void }) {
	const [open, setOpen] = useState(false)
	const [activeIndex, setActiveIndex] = useState(-1)
	const [openAbove, setOpenAbove] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)
	const activeOptionRef = useRef<HTMLLIElement>(null)
	const listboxId = 'municipality-listbox'
	const activeOptionId = activeIndex >= 0 && activeIndex < options.length ? `municipality-option-${options[activeIndex].id}` : undefined

	useEffect(() => {
		activeOptionRef.current?.scrollIntoView({ block: 'nearest' })
	}, [activeIndex])

	const showOptions = () => {
		const bounds = inputRef.current?.getBoundingClientRect()
		if (bounds) {
			const spaceBelow = window.innerHeight - bounds.bottom
			const menuHeight = Math.min(256, window.innerHeight * 0.4)
			setOpenAbove(spaceBelow < menuHeight && bounds.top > spaceBelow)
		}
		setOpen(true)
		setActiveIndex(options.length ? 0 : -1)
	}

	const selectOption = (municipality: MunicipioOption) => {
		onSelect(municipality)
		setOpen(false)
		setActiveIndex(-1)
	}

	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault()
			if (!open) setOpen(true)
			setActiveIndex((current) => options.length ? Math.min(current < 0 ? 0 : current + 1, options.length - 1) : -1)
		} else if (event.key === 'ArrowUp') {
			event.preventDefault()
			if (!open) setOpen(true)
			setActiveIndex((current) => options.length ? Math.max(current < 0 ? options.length - 1 : current - 1, 0) : -1)
		} else if (event.key === 'Enter' && open && options.length) {
			event.preventDefault()
			selectOption(options[activeIndex < 0 ? 0 : activeIndex])
		} else if (event.key === 'Escape' && open) {
			event.preventDefault()
			setOpen(false)
			setActiveIndex(-1)
		}
	}

	return <div className="field municipality-field" onBlur={(event) => {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
	}}>
		<label htmlFor="municipality-search">Município</label>
		<div className="municipality-combobox">
			<input
				ref={inputRef}
				id="municipality-search"
				className="municipality-input"
				type="search"
				role="combobox"
				autoComplete="off"
				aria-autocomplete="list"
				aria-expanded={open}
				aria-controls={listboxId}
				aria-activedescendant={open ? activeOptionId : undefined}
				value={query}
				disabled={!selectedUf}
				placeholder={selectedUf ? 'Buscar município' : 'Selecione a UF primeiro'}
				onFocus={showOptions}
				onClick={() => { if (!open) showOptions() }}
				onChange={(event) => { onQueryChange(event.target.value); setOpen(true); setActiveIndex(0) }}
				onKeyDown={handleKeyDown}
			/>
			{open && selectedUf && <ul id={listboxId} className={`municipality-listbox${openAbove ? ' municipality-listbox-above' : ''}`} role="listbox" aria-label={`Municípios de ${selectedUf}`}>
				{options.length ? options.map((item, index) => <li
					id={`municipality-option-${item.id}`}
					key={item.id}
					ref={index === activeIndex ? activeOptionRef : undefined}
					className={`municipality-option${index === activeIndex ? ' municipality-option-active' : ''}`}
					role="option"
					aria-selected={item.id === code}
					onMouseEnter={() => setActiveIndex(index)}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => selectOption(item)}
				>{item.noMunicipio}</li>) : <li className="municipality-empty" role="option" aria-disabled="true">Nenhum município encontrado</li>}
			</ul>}
		</div>
	</div>
}
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><Search size={25} /><strong>{title}</strong><span>{detail}</span></div> }
function Pagination({
	page,
	total,
	totalPages,
	onPage,
	loading,
	pageSize = PAGE_SIZE,
	pageSizes,
	onPageSize,
}: {
	page: number
	total: number
	totalPages: number
	onPage: (page: number) => void
	loading: boolean
	pageSize?: number
	pageSizes?: number[]
	onPageSize?: (pageSize: number) => void
}) {
	const pages = Math.max(1, totalPages)
	const first = total ? (page - 1) * pageSize + 1 : 0
	const last = Math.min(page * pageSize, total)
	return <div className="pagination">
		<span>Mostrando {first}–{last} de {total} resultados</span>
		<div className="pagination-controls">
			{pageSizes && onPageSize && <label className="pagination-page-size">Mostrar
				<select value={pageSize} disabled={loading} onChange={(event) => onPageSize(Number(event.target.value))}>
					{pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
				</select>
				por página
			</label>}
			<button className="button" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
			<span className="pagination-page-number">{page} / {pages}</span>
			<button className="button" disabled={loading || page >= pages} onClick={() => onPage(page + 1)}>Próxima</button>
		</div>
	</div>
}
