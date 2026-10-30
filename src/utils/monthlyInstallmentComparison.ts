import type { FnsFinancialAction } from '../types/fnsFinancial'

export type InstallmentAlertType =
	| 'Aumento'
	| 'Redução'
	| 'Sem alteração'
	| 'Novo registro'
	| 'Registro ausente'
	| 'Sem dados para comparação'

export interface ComparisonPeriod {
	year: string
	month: string
}

export interface InstallmentComparisonRow {
	key: string
	actionId?: string
	description: string
	category: string
	currentValue?: number
	previousValue?: number
	difference?: number
	percentage?: number
	alertType: InstallmentAlertType
}

export function previousMonth(period: ComparisonPeriod): ComparisonPeriod {
	const date = new Date(Number(period.year), Number(period.month) - 2, 1)
	return { year: String(date.getFullYear()), month: String(date.getMonth() + 1) }
}

export function formatMonthPeriod(period: ComparisonPeriod): string {
	return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
		.format(new Date(Number(period.year), Number(period.month) - 1, 1))
}

export function financialActionIdentity(action: FnsFinancialAction): string | undefined {
	if (typeof action.id === 'number' && Number.isFinite(action.id) && action.id > 0) return String(action.id)
	if (typeof action.id === 'string' && action.id.trim() && action.id.trim() !== '0') return action.id.trim()
	return undefined
}

export function financialActionValue(action: FnsFinancialAction): number | undefined {
	const value = action.valorLiquido
	const numericValue = typeof value === 'number'
		? value
		: typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : undefined
	return numericValue !== undefined && Number.isFinite(numericValue) && numericValue >= 0
		? Math.round(numericValue * 100) / 100
		: undefined
}

function nestedName(value: unknown): string | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	const name = (value as Record<string, unknown>).nome
	return typeof name === 'string' && name.trim() ? name.trim() : undefined
}

export function financialActionCategory(action: FnsFinancialAction): string {
	return nestedName(action.grupoAcao)
		?? nestedName(action.componenteBloco)
		?? (typeof action.formaRepasse === 'string' && action.formaRepasse.trim() ? action.formaRepasse.trim() : 'Sem categoria informada')
}

function description(action: FnsFinancialAction): string {
	for (const value of [action.descricao, action.nomeResumido, action.sigla]) {
		if (typeof value === 'string' && value.trim()) return value.trim()
	}
	return 'Ação sem descrição informada'
}

function cents(value: number): number {
	return Math.round(value * 100)
}

function makeRow(
	key: string,
	actionId: string | undefined,
	current: FnsFinancialAction | undefined,
	previous: FnsFinancialAction | undefined,
): InstallmentComparisonRow {
	const currentValue = current ? financialActionValue(current) : undefined
	const previousValue = previous ? financialActionValue(previous) : undefined
	const action = current ?? previous
	const common = {
		key,
		...(actionId ? { actionId } : {}),
		description: action ? description(action) : 'Ação sem descrição informada',
		category: action ? financialActionCategory(action) : 'Sem categoria informada',
		...(currentValue !== undefined ? { currentValue } : {}),
		...(previousValue !== undefined ? { previousValue } : {}),
	}

	if (!actionId || (current && currentValue === undefined) || (previous && previousValue === undefined)) {
		return { ...common, alertType: 'Sem dados para comparação' }
	}
	if (!previous) return { ...common, alertType: 'Novo registro' }
	if (!current) return { ...common, alertType: 'Registro ausente' }

	const currentAmount = currentValue
	const previousAmount = previousValue
	if (currentAmount === undefined || previousAmount === undefined) {
		return { ...common, alertType: 'Sem dados para comparação' }
	}
	const differenceCents = cents(currentAmount) - cents(previousAmount)
	const difference = differenceCents / 100
	if (differenceCents === 0) return { ...common, difference: 0, alertType: 'Sem alteração' }
	const percentage = previousAmount > 0
		? differenceCents / cents(previousAmount) * 100
		: undefined
	return {
		...common,
		difference,
		...(percentage !== undefined ? { percentage } : {}),
		alertType: differenceCents > 0 ? 'Aumento' : 'Redução',
	}
}

export function compareFinancialActions(
	currentActions: FnsFinancialAction[],
	previousActions: FnsFinancialAction[],
	unitKey: string,
): InstallmentComparisonRow[] {
	const currentById = new Map<string, FnsFinancialAction[]>()
	const previousById = new Map<string, FnsFinancialAction[]>()
	const currentWithoutId: FnsFinancialAction[] = []
	const previousWithoutId: FnsFinancialAction[] = []
	for (const action of currentActions) {
		const id = financialActionIdentity(action)
		if (!id) currentWithoutId.push(action)
		else currentById.set(id, [...(currentById.get(id) ?? []), action])
	}
	for (const action of previousActions) {
		const id = financialActionIdentity(action)
		if (!id) previousWithoutId.push(action)
		else previousById.set(id, [...(previousById.get(id) ?? []), action])
	}

	const rows: InstallmentComparisonRow[] = []
	const ids = new Set([...currentById.keys(), ...previousById.keys()])
	for (const id of ids) {
		const current = currentById.get(id) ?? []
		const previous = previousById.get(id) ?? []
		if (current.length > 1 || previous.length > 1) {
			const action = current[0] ?? previous[0]
			rows.push({
				key: `${unitKey}:${id}:ambiguous`,
				actionId: id,
				description: action ? description(action) : 'Ação com identificador duplicado',
				category: action ? financialActionCategory(action) : 'Sem categoria informada',
				alertType: 'Sem dados para comparação',
			})
			continue
		}
		rows.push(makeRow(`${unitKey}:${id}`, id, current[0], previous[0]))
	}
	currentWithoutId.forEach((action, index) => rows.push(makeRow(`${unitKey}:current-unidentified:${index}`, undefined, action, undefined)))
	previousWithoutId.forEach((action, index) => rows.push(makeRow(`${unitKey}:previous-unidentified:${index}`, undefined, undefined, action)))
	return rows
}

export function sumFinancialActions(actions: FnsFinancialAction[]): number | undefined {
	if (actions.length === 0) return undefined
	let totalCents = 0
	for (const action of actions) {
		const value = financialActionValue(action)
		if (value === undefined) return undefined
		totalCents += cents(value)
	}
	return totalCents / 100
}
