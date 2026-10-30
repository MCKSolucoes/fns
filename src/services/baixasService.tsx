import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { useLocation } from 'react-router-dom'
import { backendRequest } from './backendApi'
import { AppDataContext, type AppDataValue } from './appDataContext'
import type { Baixa, Deputado, EmendaEstadual, EmendaSnapshot, HistoricoAlteracao, Repasse } from '../types'
import { useBackendSession } from './backendSession'

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapSettledRows<T>(
	result: PromiseSettledResult<unknown>,
	resource: string,
	mapRow: (row: Row) => T,
): { rows: T[]; error?: string } {
	if (result.status === 'rejected') {
		return {
			rows: [],
			error: result.reason instanceof Error ? result.reason.message : `Não foi possível carregar ${resource}.`,
		}
	}
	if (!Array.isArray(result.value)) {
		return { rows: [], error: `O backend retornou dados inválidos para ${resource}.` }
	}
	try {
		const rows = result.value.map((row) => {
			if (!isRow(row)) throw new Error(`O backend retornou dados inválidos para ${resource}.`)
			return mapRow(row)
		})
		return { rows }
	} catch (error) {
		return {
			rows: [],
			error: error instanceof Error ? error.message : `Não foi possível carregar ${resource}.`,
		}
	}
}

function stringValue(value: unknown): string {
	return typeof value === 'string' ? value : ''
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value ? value : undefined
}

function numberValue(value: unknown): number {
	const numeric = typeof value === 'number' ? value : Number(value)
	return Number.isFinite(numeric) ? numeric : 0
}

function hasAmount(value: unknown): boolean {
	return (typeof value === 'number' && Number.isFinite(value))
		|| (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
}

function asEmendaSnapshot(value: unknown): EmendaSnapshot | undefined {
	if (!isRow(value)) return undefined
	const id = stringValue(value.id)
	const uf = stringValue(value.uf)
	const identificacao = stringValue(value.identificacao)
	const valor = numberValue(value.valor)
	const objeto = stringValue(value.objeto)
	if (!id || !uf || !identificacao) return undefined
	return {
		id,
		uf,
		identificacao,
		valor,
		objeto,
		...(optionalString(value.observacoes) ? { observacoes: stringValue(value.observacoes) } : {}),
	}
}

function fromBaixaRow(row: Row): Baixa {
	const snapshot = asEmendaSnapshot(row.emenda_snapshot)
	return {
		id: stringValue(row.id),
		transferId: stringValue(row.transfer_identifier),
		...(optionalString(row.repasse_id) ? { repasseId: stringValue(row.repasse_id) } : {}),
		...(isRow(row.repasse_snapshot) ? { repasseSnapshot: row.repasse_snapshot as Partial<Repasse> } : {}),
		beneficiary: stringValue(row.beneficiary),
		...(optionalString(row.document) ? { document: stringValue(row.document) } : {}),
		paidAmount: numberValue(row.paid_amount),
		...(optionalString(row.payment_date) ? { paymentDate: stringValue(row.payment_date) } : {}),
		status: stringValue(row.status) as Baixa['status'],
		description: stringValue(row.description),
		...(optionalString(row.document_reference) ? { documentReference: stringValue(row.document_reference) } : {}),
		...(optionalString(row.deputado_id) ? { deputadoId: stringValue(row.deputado_id) } : {}),
		...(optionalString(row.deputado_nome_snapshot) ? { deputadoResponsavel: stringValue(row.deputado_nome_snapshot) } : {}),
		...(optionalString(row.emenda_id) ? { emendaId: stringValue(row.emenda_id) } : {}),
		...(snapshot ? { emendaSnapshot: snapshot, emendaIdentificacao: `${snapshot.uf} · ${snapshot.identificacao}` } : {}),
		createdAt: stringValue(row.created_at),
		updatedAt: stringValue(row.updated_at),
	}
}

function fromEmendaRow(row: Row): EmendaEstadual {
	return {
		id: stringValue(row.id),
		uf: stringValue(row.uf),
		identificacao: stringValue(row.identificacao),
		valor: numberValue(row.valor),
		objeto: stringValue(row.objeto),
		...(optionalString(row.observacoes) ? { observacoes: stringValue(row.observacoes) } : {}),
	}
}

function fromDeputyRow(row: Row): Deputado {
	return {
		id: stringValue(row.id),
		nome: stringValue(row.nome),
		...(optionalString(row.partido) ? { partido: stringValue(row.partido) } : {}),
		...(optionalString(row.uf) ? { uf: stringValue(row.uf) } : {}),
		...(optionalString(row.observacoes) ? { observacoes: stringValue(row.observacoes) } : {}),
	}
}

function fromHistoryRow(row: Row): HistoricoAlteracao {
	const previous = isRow(row.previous_values) ? row.previous_values : {}
	const current = isRow(row.new_values) ? row.new_values : {}
	const emenda = asEmendaSnapshot(row.emenda_snapshot)
	const action = stringValue(row.event_type)
	return {
		id: stringValue(row.id),
		transferId: stringValue(row.transfer_identifier),
		baixaId: stringValue(row.baixa_id),
		action: action === 'criada' ? 'Baixa criada' : action === 'excluida' ? 'Baixa excluída' : action === 'atualizada' ? 'Baixa atualizada' : action,
		timestamp: stringValue(row.occurred_at),
		description: stringValue(row.description),
		...(typeof previous.status === 'string' ? { previousStatus: previous.status as Baixa['status'] } : {}),
		...(typeof current.status === 'string' ? { newStatus: current.status as Baixa['status'] } : {}),
		...(previous.paid_amount !== undefined ? { previousAmount: numberValue(previous.paid_amount) } : {}),
		...(current.paid_amount !== undefined ? { newAmount: numberValue(current.paid_amount) } : {}),
		...(optionalString(row.deputado_nome_snapshot) ? { deputadoResponsavel: stringValue(row.deputado_nome_snapshot) } : {}),
		...(emenda ? { emendaId: emenda.id, emendaIdentificacao: `${emenda.uf} · ${emenda.identificacao}`, emendaSnapshot: emenda } : {}),
		...(isRow(row.baixa_snapshot) ? { baixaSnapshot: row.baixa_snapshot as HistoricoAlteracao['baixaSnapshot'] } : {}),
	}
}

function emendaSnapshot(emenda?: EmendaEstadual): Record<string, unknown> {
	return emenda ? {
		id: emenda.id,
		uf: emenda.uf,
		identificacao: emenda.identificacao,
		valor: emenda.valor,
		objeto: emenda.objeto,
		observacoes: emenda.observacoes ?? null,
	} : {}
}

interface ImportedRepassePage {
	items: Row[]
	total: number
	page: number
	pageSize: number
}

async function loadImportedRepasses(accessToken: string): Promise<Repasse[]> {
	const pageSize = 100
	const firstPage = await backendRequest<ImportedRepassePage>(`/api/data/repasses?page=1&pageSize=${pageSize}`, accessToken)
	if (!isRow(firstPage) || !Array.isArray(firstPage.items)
		|| !Number.isInteger(firstPage.total) || firstPage.total < 0
		|| firstPage.page !== 1 || firstPage.pageSize !== pageSize) {
		throw new Error('O Supabase retornou uma página inválida de repasses oficiais.')
	}
	const pages = [firstPage]
	const totalPages = Math.ceil(firstPage.total / pageSize)
	for (let page = 2; page <= totalPages; page += 1) {
		const result = await backendRequest<ImportedRepassePage>(`/api/data/repasses?page=${page}&pageSize=${pageSize}`, accessToken)
		if (!isRow(result) || !Array.isArray(result.items)
			|| !Number.isInteger(result.total) || result.total !== firstPage.total
			|| result.page !== page || result.pageSize !== pageSize) {
			throw new Error('O Supabase retornou uma página inválida de repasses oficiais.')
		}
		pages.push(result)
	}
	const rows = pages.flatMap((page) => page.items)
	if (rows.length !== firstPage.total) throw new Error('A consulta dos repasses oficiais retornou um total incompleto.')
	return rows.map((row) => {
		const sourceData = isRow(row.source_data) ? row.source_data : {}
		const action = isRow(sourceData.record) ? sourceData.record : {}
		const transferId = stringValue(row.transfer_identifier)
		const storageId = stringValue(row.id)
		const year = numberValue(row.reference_year)
		if (!transferId || !storageId || year < 1900) {
			throw new Error('Um repasse importado não possui identificadores ou ano válidos.')
		}
		const description = stringValue(action.descricao)
		return {
			id: transferId,
			storageId,
			year,
			month: numberValue(row.reference_month),
			entity: stringValue(row.beneficiary_name),
			beneficiary: stringValue(row.beneficiary_name),
			document: stringValue(row.beneficiary_cnpj),
			city: stringValue(row.municipality_name),
			state: stringValue(row.municipality_uf),
			municipalityIbge: stringValue(row.municipality_ibge),
			block: stringValue(action.componenteBloco ?? action.blocoPacto),
			group: stringValue(action.grupoAcao),
			action: description,
			detailedAction: description,
			processNumber: transferId,
			grossAmount: numberValue(row.gross_amount),
			discountAmount: numberValue(row.discount_amount),
			netAmount: numberValue(row.net_amount),
			hasOfficialNetAmount: hasAmount(row.net_amount),
			transferType: stringValue(row.query_type),
			portaria: stringValue(action.portaria),
		}
	})
}

export function AppDataProvider({ children }: PropsWithChildren) {
	const { accessToken, hasSharedAccess, sharedStorageLoading, sharedStorageError } = useBackendSession()
	const { pathname } = useLocation()
	const shouldLoadDashboardBaixas = pathname === '/'
	const shouldLoadAuxiliaryData = pathname !== '/' && pathname !== '/consultas' && pathname !== '/repasses-importados'
	const [baixas, setBaixas] = useState<Baixa[]>([])
	const [history, setHistory] = useState<HistoricoAlteracao[]>([])
	const [emendas, setEmendas] = useState<EmendaEstadual[]>([])
	const [deputies, setDeputies] = useState<Deputado[]>([])
	const [repasses, setRepasses] = useState<Repasse[]>([])
	const [repassesLoading, setRepassesLoading] = useState(true)
	const [repassesError, setRepassesError] = useState('')
	const [dataLoading, setDataLoading] = useState(true)
	const [dataError, setDataError] = useState('')

	const reload = useCallback(async () => {
		if (sharedStorageLoading) {
			setDataLoading(true)
			return
		}
		if (!hasSharedAccess) {
			setBaixas([])
			setHistory([])
			setEmendas([])
			setDeputies([])
			setRepasses([])
			setRepassesError(sharedStorageError || 'Os repasses oficiais do Supabase não estão disponíveis.')
			setRepassesLoading(false)
			setDataError(sharedStorageError || 'A persistência Supabase está indisponível. Configure SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY e SUPABASE_TEST_MODE=true no backend local; nenhum dado operacional foi carregado ou salvo localmente.')
			setDataLoading(false)
			return
		}
		setDataLoading(true)
		setRepassesLoading(true)
		setDataError('')
		setRepassesError('')
		try {
			const [importedRepasses, auxiliaryResults] = await Promise.all([
				loadImportedRepasses(accessToken),
				shouldLoadDashboardBaixas || shouldLoadAuxiliaryData
					? Promise.allSettled([
						backendRequest<unknown>('/api/data/baixas', accessToken),
						shouldLoadAuxiliaryData ? backendRequest<unknown>('/api/data/history', accessToken) : Promise.resolve<unknown>([]),
						shouldLoadAuxiliaryData ? backendRequest<unknown>('/api/data/amendments', accessToken) : Promise.resolve<unknown>([]),
						shouldLoadAuxiliaryData ? backendRequest<unknown>('/api/data/deputies', accessToken) : Promise.resolve<unknown>([]),
					])
					: Promise.resolve(null),
			])
			setRepasses(importedRepasses)
			if (auxiliaryResults) {
				const [baixasResult, historyResult, emendasResult, deputiesResult] = auxiliaryResults
				const baixasData = mapSettledRows(baixasResult, 'as baixas', fromBaixaRow)
				const historyData = mapSettledRows(historyResult, 'o histórico', fromHistoryRow)
				const emendasData = mapSettledRows(emendasResult, 'as emendas', fromEmendaRow)
				const deputiesData = mapSettledRows(deputiesResult, 'os deputados', fromDeputyRow)
				setBaixas(baixasData.rows)
				setHistory(historyData.rows)
				setEmendas(emendasData.rows)
				setDeputies(deputiesData.rows)
				setDataError(shouldLoadDashboardBaixas
					? baixasData.error ?? ''
					: [
						baixasData.error,
						historyData.error,
						emendasData.error,
						deputiesData.error,
					].filter((error): error is string => Boolean(error))[0] ?? '')
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Não foi possível carregar os dados compartilhados.'
			setDataError(message)
			setRepassesError(message)
			setBaixas([])
			setHistory([])
			setEmendas([])
			setDeputies([])
			setRepasses([])
			throw error
		} finally {
			setDataLoading(false)
			setRepassesLoading(false)
		}
	}, [accessToken, hasSharedAccess, sharedStorageError, sharedStorageLoading, shouldLoadAuxiliaryData, shouldLoadDashboardBaixas])

	useEffect(() => {
		void Promise.resolve().then(reload).catch(() => {})
	}, [reload])

	const saveBaixa = useCallback(async (
		baixa: Baixa,
		previous?: Baixa,
		deputadoResponsavel?: string,
		emendaId?: string,
	) => {
		if (!hasSharedAccess) throw new Error('A persistência Supabase está indisponível. A baixa não foi salva.')
		const repasse = repasses.find((item) => item.storageId === baixa.repasseId || (!baixa.repasseId && item.id === baixa.transferId))
		if (!repasse) throw new Error('O repasse oficial associado à baixa não foi encontrado no Supabase.')
		const emenda = emendas.find((item) => item.id === (emendaId ?? baixa.emendaId))
		const deputyName = deputadoResponsavel?.trim() || baixa.deputadoResponsavel?.trim()
		const payload = {
			repasse_id: repasse.storageId ?? null,
			transfer_identifier: baixa.transferId,
			repasse_snapshot: repasse ?? baixa.repasseSnapshot ?? {},
			deputado_id: baixa.deputadoId ?? null,
			deputado_nome_snapshot: deputyName || null,
			emenda_id: emenda?.id ?? baixa.emendaId ?? null,
			emenda_snapshot: emenda ? emendaSnapshot(emenda) : baixa.emendaSnapshot ?? {},
			beneficiary: baixa.beneficiary,
			document: baixa.document ?? null,
			paid_amount: baixa.paidAmount,
			payment_date: baixa.paymentDate ?? null,
			status: baixa.status,
			description: baixa.description,
			document_reference: baixa.documentReference ?? null,
		}
		if (previous) {
			const rows = await backendRequest<unknown>(`/api/data/baixas/${encodeURIComponent(previous.id)}`, accessToken, { method: 'PATCH', body: payload })
			if (!Array.isArray(rows) || rows.length !== 1) throw new Error('A baixa não foi atualizada no banco de dados.')
		} else {
			const rows = await backendRequest<unknown>('/api/data/baixas', accessToken, { method: 'POST', body: payload })
			if (!Array.isArray(rows) || rows.length !== 1) throw new Error('A baixa não foi gravada no banco de dados.')
		}
		await reload()
	}, [accessToken, emendas, hasSharedAccess, reload, repasses])

	const deleteBaixa = useCallback(async (baixa: Baixa) => {
		if (!hasSharedAccess) throw new Error('A persistência Supabase está indisponível. A baixa não foi excluída.')
		const rows = await backendRequest<unknown>(`/api/data/baixas/${encodeURIComponent(baixa.id)}`, accessToken, { method: 'DELETE' })
		if (!Array.isArray(rows) || rows.length !== 1) throw new Error('A exclusão da baixa não foi confirmada pelo banco de dados.')
		await reload()
	}, [accessToken, hasSharedAccess, reload])

	const saveEmenda = useCallback(async (emenda: EmendaEstadual) => {
		if (!hasSharedAccess) throw new Error('A persistência Supabase está indisponível. A emenda não foi salva.')
		const editing = emendas.some((item) => item.id === emenda.id)
		const payload = {
			id: emenda.id,
			uf: emenda.uf,
			identificacao: emenda.identificacao,
			valor: emenda.valor,
			objeto: emenda.objeto,
			observacoes: emenda.observacoes ?? null,
		}
		const result = await backendRequest<unknown>(
			editing ? `/api/data/amendments/${encodeURIComponent(emenda.id)}` : '/api/data/amendments',
			accessToken,
			{ method: editing ? 'PATCH' : 'POST', body: payload },
		)
		if (!Array.isArray(result) || result.length !== 1) throw new Error('A emenda não foi confirmada pelo banco de dados.')
		await reload()
	}, [accessToken, emendas, hasSharedAccess, reload])

	const deleteEmenda = useCallback(async (emenda: EmendaEstadual) => {
		if (!hasSharedAccess) throw new Error('A persistência Supabase está indisponível. A emenda não foi excluída.')
		const rows = await backendRequest<unknown>(`/api/data/amendments/${encodeURIComponent(emenda.id)}`, accessToken, { method: 'DELETE' })
		if (!Array.isArray(rows) || rows.length !== 1) throw new Error('A exclusão da emenda não foi confirmada pelo banco de dados.')
		await reload()
	}, [accessToken, hasSharedAccess, reload])

	const saveDeputy = useCallback(async (deputy: Deputado) => {
		if (!hasSharedAccess) throw new Error('A persistência Supabase não está habilitada. Os dados não foram salvos.')
		const editing = deputies.some((item) => item.id === deputy.id)
		const payload = {
			id: deputy.id,
			nome: deputy.nome.trim(),
			partido: deputy.partido?.trim() || null,
			uf: deputy.uf || null,
			observacoes: deputy.observacoes?.trim() || null,
		}
		const result = await backendRequest<unknown>(
			editing ? `/api/data/deputies/${encodeURIComponent(deputy.id)}` : '/api/data/deputies',
			accessToken,
			{ method: editing ? 'PATCH' : 'POST', body: payload },
		)
		if (!Array.isArray(result) || result.length !== 1) throw new Error('O deputado não foi confirmado pelo banco de dados.')
		await reload()
	}, [accessToken, deputies, hasSharedAccess, reload])

	const deleteDeputy = useCallback(async (deputy: Deputado) => {
		if (!hasSharedAccess) throw new Error('A persistência Supabase não está habilitada. Os dados não foram alterados.')
		const rows = await backendRequest<unknown>(`/api/data/deputies/${encodeURIComponent(deputy.id)}`, accessToken, { method: 'DELETE' })
		if (!Array.isArray(rows) || rows.length !== 1) throw new Error('A exclusão do deputado não foi confirmada pelo banco de dados.')
		await reload()
	}, [accessToken, hasSharedAccess, reload])

	const value = useMemo<AppDataValue>(() => ({
		repasses,
		repassesLoading,
		repassesError,
		dataLoading,
		dataError,
		persistenceMode: hasSharedAccess ? 'supabase' : 'unavailable',
		baixas,
		history,
		emendas,
		deputies,
		saveBaixa,
		deleteBaixa,
		saveEmenda,
		deleteEmenda,
		saveDeputy,
		deleteDeputy,
		reload,
	}), [
		repasses, repassesLoading, repassesError, dataLoading, dataError, hasSharedAccess,
		baixas, history, emendas, deputies, saveBaixa, deleteBaixa,
		saveEmenda, deleteEmenda, saveDeputy, deleteDeputy, reload,
	])

	return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}
