import { backendRequest, BackendApiError } from './backendApi'
import type { Baixa, EmendaEstadual, HistoricoAlteracao } from '../types'
import type { FnsFinancialComplement, FnsFinancialLaunch } from '../types/fnsFinancial'
import type { InstallmentReview } from '../repositories/LocalStorageInstallmentReviewRepository'
import { initialBaixas, mockRepasses } from '../data/mockRepasses'
import { parseFnsFinancialLaunchAmount } from '../utils/fnsFinancialLaunch'

const LEGACY_DATA_KEY = 'fns-repasses-demo:v1'
const LEGACY_LAUNCH_KEY = 'fns-financial-launch-drafts:v1'
const LEGACY_REVIEW_KEY = 'fns-installment-reviews:v1'

export type MigrationCategory = 'amendments' | 'baixas' | 'history' | 'complements' | 'launches' | 'reviews'

export interface LocalDataMigrationSnapshot {
	categories: Record<MigrationCategory, number>
	baixas: Baixa[]
	emendas: EmendaEstadual[]
	history: HistoricoAlteracao[]
	complements: Array<{ key: string; value: FnsFinancialComplement & { updatedAt: string } }>
	launches: FnsFinancialLaunch[]
	reviews: Array<{ key: string; value: InstallmentReview }>
	skippedDemoBaixas: number
	skippedDemoHistory: number
	errors: string[]
}

export interface LocalDataMigrationResult {
	migrated: Record<MigrationCategory, number>
	errors: string[]
}

type Row = Record<string, unknown>

function isRecord(value: unknown): value is Row {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStorage(key: string, errors: string[]): unknown {
	let raw: string | null
	try {
		raw = localStorage.getItem(key)
	} catch {
		errors.push(`Não foi possível ler a chave local "${key}"; nenhum dado foi alterado.`)
		return null
	}
	if (raw === null) return null
	try {
		return JSON.parse(raw) as unknown
	} catch {
		errors.push(`A chave local "${key}" contém JSON inválido; ela foi preservada sem alterações.`)
		return null
	}
}

function validBaixa(value: unknown): value is Baixa {
	return isRecord(value)
		&& typeof value.id === 'string'
		&& typeof value.transferId === 'string'
		&& typeof value.beneficiary === 'string'
		&& typeof value.paidAmount === 'number'
		&& typeof value.status === 'string'
		&& typeof value.description === 'string'
}

function validEmenda(value: unknown): value is EmendaEstadual {
	return isRecord(value)
		&& typeof value.id === 'string'
		&& typeof value.uf === 'string'
		&& typeof value.identificacao === 'string'
		&& typeof value.valor === 'number'
		&& typeof value.objeto === 'string'
}

function validHistory(value: unknown): value is HistoricoAlteracao {
	return isRecord(value)
		&& typeof value.id === 'string'
		&& typeof value.baixaId === 'string'
		&& typeof value.transferId === 'string'
		&& typeof value.action === 'string'
		&& typeof value.timestamp === 'string'
}

function validComplement(value: unknown): value is FnsFinancialComplement & { updatedAt: string } {
	return isRecord(value)
		&& typeof value.observations === 'string'
		&& typeof value.reviewStatus === 'string'
		&& typeof value.reviewResponsible === 'string'
		&& typeof value.internalReference === 'string'
		&& typeof value.updatedAt === 'string'
}

function validLaunch(value: unknown): value is FnsFinancialLaunch {
	return isRecord(value)
		&& typeof value.actionKey === 'string'
		&& typeof value.status === 'string'
		&& typeof value.amount === 'string'
		&& typeof value.date === 'string'
		&& typeof value.documentNumber === 'string'
		&& typeof value.accountReference === 'string'
		&& typeof value.responsible === 'string'
		&& typeof value.observations === 'string'
		&& typeof value.createdAt === 'string'
		&& typeof value.updatedAt === 'string'
}

function validReview(value: unknown): value is InstallmentReview {
	return isRecord(value)
		&& (value.status === 'Pendente' || value.status === 'Analisado')
		&& typeof value.justificativa === 'string'
		&& typeof value.updatedAt === 'string'
}

function unchangedDemoBaixa(baixa: Baixa): boolean {
	const seeded = initialBaixas.find((item) => item.id === baixa.id)
	return Boolean(seeded && JSON.stringify(seeded) === JSON.stringify(baixa))
}

export function inspectLocalData(): LocalDataMigrationSnapshot {
	const errors: string[] = []
	const stored = readStorage(LEGACY_DATA_KEY, errors)
	const baixas: Baixa[] = []
	const emendas: EmendaEstadual[] = []
	const history: HistoricoAlteracao[] = []
	const complements: LocalDataMigrationSnapshot['complements'] = []

	if (stored !== null) {
		if (!isRecord(stored) || ![1, 2].includes(Number(stored.version))
			|| !Array.isArray(stored.baixas) || !Array.isArray(stored.history)) {
			errors.push(`A chave local "${LEGACY_DATA_KEY}" tem um formato incompatível; ela foi preservada.`)
		} else {
			for (const item of stored.baixas) {
				if (validBaixa(item)) {
					if (!unchangedDemoBaixa(item)) baixas.push(item)
				} else errors.push('Há uma baixa local em formato inválido; o registro foi preservado e não será migrado.')
			}
			for (const item of stored.history) {
				if (validHistory(item)) {
					if (!item.id.startsWith('inicial-')) history.push(item)
				} else errors.push('Há um evento de histórico local em formato inválido; o registro foi preservado e não será migrado.')
			}
			if (Array.isArray(stored.emendas)) {
				for (const item of stored.emendas) {
					if (validEmenda(item)) emendas.push(item)
					else errors.push('Há uma emenda local em formato inválido; o registro foi preservado e não será migrado.')
				}
			}
			if (isRecord(stored.financialComplements)) {
				for (const [key, value] of Object.entries(stored.financialComplements)) {
					if (validComplement(value)) complements.push({ key, value })
					else errors.push(`O complemento financeiro local "${key}" é inválido e foi preservado.`)
				}
			}
		}
	}

	const launchData = readStorage(LEGACY_LAUNCH_KEY, errors)
	const launches: FnsFinancialLaunch[] = []
	if (launchData !== null) {
		if (!isRecord(launchData) || launchData.version !== 1 || !isRecord(launchData.launches)) {
			errors.push(`A chave local "${LEGACY_LAUNCH_KEY}" tem um formato incompatível; ela foi preservada.`)
		} else {
			for (const [key, value] of Object.entries(launchData.launches)) {
				if (validLaunch(value) && value.actionKey === key) launches.push(value)
				else errors.push(`O rascunho financeiro local "${key}" é inválido e foi preservado.`)
			}
		}
	}

	const reviewData = readStorage(LEGACY_REVIEW_KEY, errors)
	const reviews: LocalDataMigrationSnapshot['reviews'] = []
	if (reviewData !== null) {
		if (!isRecord(reviewData)) {
			errors.push(`A chave local "${LEGACY_REVIEW_KEY}" tem um formato incompatível; ela foi preservada.`)
		} else {
			for (const [key, value] of Object.entries(reviewData)) {
				if (validReview(value)) reviews.push({ key, value })
				else errors.push(`A análise local "${key}" é inválida e foi preservada.`)
			}
		}
	}

	return {
		categories: {
			amendments: emendas.length,
			baixas: baixas.length,
			history: history.length,
			complements: complements.length,
			launches: launches.length,
			reviews: reviews.length,
		},
		baixas,
		emendas,
		history,
		complements,
		launches,
		reviews,
		skippedDemoBaixas: isRecord(stored) && Array.isArray(stored.baixas)
			? stored.baixas.filter((item) => validBaixa(item) && unchangedDemoBaixa(item)).length
			: 0,
		skippedDemoHistory: isRecord(stored) && Array.isArray(stored.history)
			? stored.history.filter((item) => isRecord(item) && typeof item.id === 'string' && item.id.startsWith('inicial-')).length
			: 0,
		errors,
	}
}

export async function migrateLocalData(
	accessToken: string,
	categories: readonly MigrationCategory[],
): Promise<LocalDataMigrationResult> {
	const snapshot = inspectLocalData()
	const result: LocalDataMigrationResult = {
		migrated: { amendments: 0, baixas: 0, history: 0, complements: 0, launches: 0, reviews: 0 },
		errors: [...snapshot.errors],
	}

	const [remoteEmendas, remoteBaixas] = await Promise.all([
		backendRequest<Row[]>('/api/data/amendments', accessToken),
		backendRequest<Row[]>('/api/data/baixas', accessToken),
	])
	const amendmentsByLegacyId = new Map(
		remoteEmendas.flatMap((row) => typeof row.legacy_id === 'string' && typeof row.id === 'string' ? [[row.legacy_id, row.id] as const] : []),
	)
	const baixasByLegacyId = new Map(
		remoteBaixas.flatMap((row) => typeof row.legacy_id === 'string' && typeof row.id === 'string' ? [[row.legacy_id, row.id] as const] : []),
	)
	const amendmentsById = new Map<string, string>()

	if (categories.includes('amendments')) {
		for (const emenda of snapshot.emendas) {
			try {
				const response = await backendRequest<Row[]>('/api/data/amendments', accessToken, {
					method: 'POST',
					body: {
						legacy_id: emenda.id,
						uf: emenda.uf,
						identificacao: emenda.identificacao,
						valor: emenda.valor,
						objeto: emenda.objeto,
						observacoes: emenda.observacoes ?? null,
						legacy_created_at: null,
						legacy_updated_at: null,
					},
				})
				if (response[0]?.id) amendmentsByLegacyId.set(emenda.id, String(response[0].id))
				result.migrated.amendments += response.length
			} catch (error) {
				result.errors.push(`Emenda ${emenda.id}: ${errorMessage(error)}`)
			}
		}
	}
	for (const [legacyId, id] of amendmentsByLegacyId) amendmentsById.set(legacyId, id)

	if (categories.includes('baixas')) {
		for (const baixa of snapshot.baixas) {
			try {
				const repasse = mockRepasses.find((item) => item.id === baixa.transferId)
				const response = await backendRequest<Row[]>('/api/data/baixas', accessToken, {
					method: 'POST',
					body: {
						legacy_id: baixa.id,
						repasse_id: null,
						repasse_snapshot: baixa.repasseSnapshot ?? repasse ?? {},
						transfer_identifier: baixa.transferId,
						deputado_id: null,
						deputado_nome_snapshot: baixa.deputadoResponsavel ?? null,
						emenda_id: baixa.emendaId ? amendmentsById.get(baixa.emendaId) ?? null : null,
						emenda_snapshot: baixa.emendaSnapshot ?? {},
						beneficiary: baixa.beneficiary,
						document: baixa.document ?? null,
						paid_amount: baixa.paidAmount,
						payment_date: baixa.paymentDate ?? null,
						status: baixa.status,
						description: baixa.description,
						document_reference: baixa.documentReference ?? null,
						legacy_created_at: validTimestamp(baixa.createdAt),
						legacy_updated_at: validTimestamp(baixa.updatedAt),
					},
				})
				if (response[0]?.id) baixasByLegacyId.set(baixa.id, String(response[0].id))
				result.migrated.baixas += response.length
			} catch (error) {
				result.errors.push(`Baixa ${baixa.id}: ${errorMessage(error)}`)
			}
		}
	}

	if (categories.includes('history')) {
		for (const event of snapshot.history) {
			try {
				const response = await backendRequest<Row[]>('/api/data/history', accessToken, {
					method: 'POST',
					body: {
						legacy_id: event.id,
						baixa_id: baixasByLegacyId.get(event.baixaId) ?? null,
						transfer_identifier: event.transferId,
						event_type: event.action,
						occurred_at: validTimestamp(event.timestamp),
						description: event.description,
						justification: null,
						previous_values: {
							status: event.previousStatus ?? null,
							paid_amount: event.previousAmount ?? null,
						},
						new_values: {
							status: event.newStatus ?? null,
							paid_amount: event.newAmount ?? null,
						},
						repasse_snapshot: {},
						emenda_snapshot: event.emendaSnapshot ?? {},
						deputado_nome_snapshot: event.deputadoResponsavel ?? null,
						baixa_snapshot: event.baixaSnapshot ?? {},
					},
				})
				result.migrated.history += response.length
			} catch (error) {
				result.errors.push(`Histórico ${event.id}: ${errorMessage(error)}`)
			}
		}
	}

	if (categories.includes('complements')) {
		for (const { key, value } of snapshot.complements) {
			try {
				const response = await backendRequest<Row[]>('/api/data/complements', accessToken, {
					method: 'POST',
					body: {
						action_key: key,
						observations: value.observations,
						review_status: value.reviewStatus,
						review_responsible: value.reviewResponsible,
						internal_reference: value.internalReference,
						legacy_updated_at: validTimestamp(value.updatedAt),
					},
				})
				result.migrated.complements += response.length
			} catch (error) {
				result.errors.push(`Complemento ${key}: ${errorMessage(error)}`)
			}
		}
	}

	if (categories.includes('launches')) {
		for (const launch of snapshot.launches) {
			try {
				const amount = parseFnsFinancialLaunchAmount(launch.amount)
				if (amount === undefined) throw new Error('Valor local inválido.')
				const response = await backendRequest<Row[]>('/api/data/launches', accessToken, {
					method: 'POST',
					body: {
						action_key: launch.actionKey,
						status: launch.status,
						amount,
						launch_date: launch.date || null,
						document_number: launch.documentNumber,
						account_reference: launch.accountReference,
						responsible: launch.responsible,
						observations: launch.observations,
						legacy_created_at: validTimestamp(launch.createdAt),
						legacy_updated_at: validTimestamp(launch.updatedAt),
					},
				})
				result.migrated.launches += response.length
			} catch (error) {
				result.errors.push(`Lançamento ${launch.actionKey}: ${errorMessage(error)}`)
			}
		}
	}

	if (categories.includes('reviews')) {
		for (const { key, value } of snapshot.reviews) {
			try {
				const response = await backendRequest<Row[]>('/api/data/reviews', accessToken, {
					method: 'POST',
					body: {
						legacy_id: `local-review:${key}`,
						alert_key: key,
						status: value.status,
						justification: value.justificativa,
						alert_snapshot: { originalLocalKey: key },
						occurred_at: validTimestamp(value.updatedAt),
					},
				})
				result.migrated.reviews += response.length
			} catch (error) {
				result.errors.push(`Análise ${key}: ${errorMessage(error)}`)
			}
		}
	}

	return result
}

function validTimestamp(value: string): string | null {
	return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
}

function errorMessage(error: unknown): string {
	if (error instanceof BackendApiError) return error.message
	return error instanceof Error ? error.message : 'Falha inesperada.'
}
