import type { MunicipioOption } from '../types/fnsResources'
import type { FnsConsultationEntity, FnsConsultationFilters } from '../types/fnsConsultation'
import type { FnsFinancialAction } from '../types/fnsFinancial'
import { getAllFnsFinancialPages } from './fnsFinancialService'
import { fnsResourcesService } from './fnsResourcesService'
import { compareFinancialActions, financialActionValue, type InstallmentComparisonRow } from '../utils/monthlyInstallmentComparison'

const ENTITY_PAGE_SIZE = 100
const ENTITY_CONCURRENCY = 2

export interface MonthlyComparisonFilters {
	year: string
	month: string
	queryType: string
	municipality: MunicipioOption
}

export interface ComparedUnit {
	key: string
	name: string
	document?: string
	currentActions: FnsFinancialAction[]
	previousActions: FnsFinancialAction[]
}

export interface MonthlyComparisonResult {
	previousYear: string
	previousMonth: string
	currentEntities: number
	previousEntities: number
	units: ComparedUnit[]
	rows: Array<InstallmentComparisonRow & { municipality: string; unit: string; unitKey: string }>
	currentTotal?: number
	previousTotal?: number
}

interface PeriodEntities {
	entities: FnsConsultationEntity[]
}

function documentOf(entity: FnsConsultationEntity): string {
	const document = entity.cpfCnpj ?? entity.cpfCnpjFormatado
	return document === undefined || document === null ? '' : String(document).replace(/\D/g, '')
}

function nameOf(entity: FnsConsultationEntity): string {
	return typeof entity.razaoSocial === 'string' && entity.razaoSocial.trim()
		? entity.razaoSocial.trim()
		: 'Unidade sem nome informado'
}

async function getAllEntities(
	filters: FnsConsultationFilters,
	signal: AbortSignal,
): Promise<PeriodEntities> {
	const first = await fnsResourcesService.getConsultas(filters, 1, ENTITY_PAGE_SIZE, signal)
	const pages = Math.max(first.totalPaginas, first.dados.length ? 1 : 0)
	if (first.pagina !== 1 || first.itensPorPagina < 0 || first.itensPorPagina > ENTITY_PAGE_SIZE) {
		throw new Error('O FNS retornou uma paginação inválida para as entidades.')
	}
	const entities = [...first.dados]
	for (let page = 2; page <= pages; page += 1) {
		const response = await fnsResourcesService.getConsultas(filters, page, ENTITY_PAGE_SIZE, signal)
		if (response.pagina !== page || response.total !== first.total || response.totalPaginas !== first.totalPaginas) {
			throw new Error('A paginação das entidades mudou durante a comparação. Tente novamente.')
		}
		entities.push(...response.dados)
	}
	if (entities.length !== first.total) {
		throw new Error(`O FNS retornou ${entities.length} de ${first.total} entidades para o período.`)
	}
	return { entities }
}

function financialFilters(
	entity: FnsConsultationEntity,
	filters: MonthlyComparisonFilters,
	year: string,
	month: string,
) {
	return {
		ano: year,
		cpfCnpjUg: documentOf(entity),
		estado: filters.municipality.sgUf,
		mes: month,
		municipio: filters.municipality.id,
		tipoConsulta: filters.queryType || undefined,
	}
}

function consultationFilters(
	filters: MonthlyComparisonFilters,
	year: string,
	month: string,
): FnsConsultationFilters {
	return {
		ano: year,
		mes: month,
		tipoConsulta: filters.queryType || undefined,
		estado: filters.municipality.sgUf,
		municipio: filters.municipality.id,
	}
}

function uniqueEntities(entities: FnsConsultationEntity[], periodKey: string): Map<string, FnsConsultationEntity> {
	const result = new Map<string, FnsConsultationEntity>()
	entities.forEach((entity, index) => {
		const document = documentOf(entity)
		const key = document ? `cnpj:${document}` : `sem-cnpj:${periodKey}:${index}`
		if (!result.has(key)) result.set(key, entity)
	})
	return result
}

async function getActionsForEntity(
	entity: FnsConsultationEntity,
	filters: MonthlyComparisonFilters,
	year: string,
	month: string,
	signal: AbortSignal,
): Promise<FnsFinancialAction[]> {
	if (!documentOf(entity)) return []
	const response = await getAllFnsFinancialPages(
		financialFilters(entity, filters, year, month),
		signal,
		() => {},
	)
	return response.dados
}

export async function loadMonthlyComparison(
	filters: MonthlyComparisonFilters,
	signal: AbortSignal,
	onProgress: (message: string) => void,
): Promise<MonthlyComparisonResult> {
	const currentDate = new Date(Number(filters.year), Number(filters.month) - 1, 1)
	const previousDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)
	const previousYear = String(previousDate.getFullYear())
	const previousMonth = String(previousDate.getMonth() + 1)
	const comparisonKey = `${filters.year}-${filters.month}:${previousYear}-${previousMonth}`
	const [currentPeriod, previousPeriod] = await Promise.all([
		getAllEntities(consultationFilters(filters, filters.year, filters.month), signal),
		getAllEntities(consultationFilters(filters, previousYear, previousMonth), signal),
	])
	const currentEntities = uniqueEntities(currentPeriod.entities, `current:${filters.year}-${filters.month}`)
	const previousEntities = uniqueEntities(previousPeriod.entities, `previous:${previousYear}-${previousMonth}`)
	const union = new Map([...previousEntities, ...currentEntities])
	const unionEntries = [...union]
	const units: ComparedUnit[] = []
	let nextIndex = 0
	let completed = 0
	const workers = Array.from({ length: Math.min(ENTITY_CONCURRENCY, union.size) }, async () => {
		while (nextIndex < unionEntries.length) {
			const index = nextIndex
			nextIndex += 1
			const [unitKey, entity] = unionEntries[index]
			const currentEntity = currentEntities.get(unitKey)
			const previousEntity = previousEntities.get(unitKey)
			const [currentActions, previousActions] = await Promise.all([
				currentEntity && documentOf(currentEntity)
					? getActionsForEntity(currentEntity, filters, filters.year, filters.month, signal)
					: Promise.resolve([]),
				previousEntity && documentOf(previousEntity)
					? getActionsForEntity(previousEntity, filters, previousYear, previousMonth, signal)
					: Promise.resolve([]),
			])
			units[index] = {
				key: unitKey,
				name: nameOf(currentEntity ?? previousEntity ?? entity),
				...(documentOf(entity) ? { document: documentOf(entity) } : {}),
				currentActions,
				previousActions,
			}
			completed += 1
			onProgress(`Consultando valores oficiais do FNS: ${completed} de ${unionEntries.length} unidade(s).`)
		}
	})
	await Promise.all(workers)

	const rows: MonthlyComparisonResult['rows'] = []
	units.forEach((unit) => {
		const hasCurrent = currentEntities.has(unit.key)
		const hasPrevious = previousEntities.has(unit.key)
		if (!unit.document) {
			rows.push({
				key: `${comparisonKey}:${unit.key}:without-document`,
				description: 'Unidade sem CPF/CNPJ para consulta financeira',
				category: 'Sem dados para comparação',
				alertType: 'Sem dados para comparação',
				municipality: filters.municipality.noMunicipio,
				unit: unit.name,
				unitKey: unit.key,
			})
			return
		}
		if (unit.currentActions.length === 0 && unit.previousActions.length === 0) {
			rows.push({
				key: `${comparisonKey}:${unit.key}:no-financial-actions`,
				description: 'Unidade sem ações financeiras retornadas para os períodos consultados',
				category: 'Sem dados para comparação',
				alertType: 'Sem dados para comparação',
				municipality: filters.municipality.noMunicipio,
				unit: unit.name,
				unitKey: unit.key,
			})
			return
		}
		if (hasCurrent && hasPrevious) {
			rows.push(...compareFinancialActions(unit.currentActions, unit.previousActions, unit.key)
				.map((row) => ({ ...row, key: `${comparisonKey}:${row.key}`, municipality: filters.municipality.noMunicipio, unit: unit.name, unitKey: unit.key })))
			return
		}
		const actions = hasCurrent ? unit.currentActions : unit.previousActions
		const side = hasCurrent ? 'current' : 'previous'
		actions.forEach((action, index) => rows.push({
			...compareFinancialActions(
				side === 'current' ? [action] : [],
				side === 'previous' ? [action] : [],
				unit.key,
			)[0],
			key: `${comparisonKey}:${unit.key}:${side}:${index}`,
			municipality: filters.municipality.noMunicipio,
			unit: unit.name,
			unitKey: unit.key,
		}))
	})

	const periodTotal = (entities: Map<string, FnsConsultationEntity>, side: 'current' | 'previous'): number | undefined => {
		if (entities.size === 0) return undefined
		const relevantUnits = units.filter((unit) => entities.has(unit.key))
		if (relevantUnits.some((unit) => !unit.document)) return undefined
		const actions = relevantUnits.flatMap((unit) => side === 'current' ? unit.currentActions : unit.previousActions)
		if (actions.length === 0) return undefined
		let totalCents = 0
		for (const action of actions) {
			const value = financialActionValue(action)
			if (value === undefined) return undefined
			totalCents += Math.round(value * 100)
		}
		return totalCents / 100
	}

	return {
		previousYear,
		previousMonth,
		currentEntities: currentPeriod.entities.length,
		previousEntities: previousPeriod.entities.length,
		units,
		rows,
		currentTotal: periodTotal(currentEntities, 'current'),
		previousTotal: periodTotal(previousEntities, 'previous'),
	}
}
