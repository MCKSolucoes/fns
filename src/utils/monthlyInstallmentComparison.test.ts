import assert from 'node:assert/strict'
import test from 'node:test'
import { compareFinancialActions, financialActionIdentity, financialActionValue, previousMonth } from './monthlyInstallmentComparison'
import type { FnsFinancialAction } from '../types/fnsFinancial'
import { LocalStorageInstallmentReviewRepository } from '../repositories/LocalStorageInstallmentReviewRepository'

function action(id: number | string, amount: number | string): FnsFinancialAction {
	return { id, descricao: `Ação ${id}`, grupoAcao: { id: 8, nome: 'Custeio' }, valorLiquido: amount }
}

test('calcula outubro de 2026 contra setembro de 2026', () => {
	assert.deepEqual(previousMonth({ year: '2026', month: '10' }), { year: '2026', month: '9' })
	assert.deepEqual(previousMonth({ year: '2026', month: '1' }), { year: '2025', month: '12' })
})

test('classifica valores iguais, maiores e menores com diferença e variação percentual', () => {
	const rows = compareFinancialActions(
		[action(1, 125), action(2, 150), action(3, 80)],
		[action(1, 125), action(2, 100), action(3, 100)],
		'unidade-1',
	)
	assert.deepEqual(rows.map(({ alertType }) => alertType), ['Sem alteração', 'Aumento', 'Redução'])
	assert.equal(rows[0].difference, 0)
	assert.equal(rows[1].difference, 50)
	assert.equal(rows[1].percentage, 50)
	assert.equal(rows[2].difference, -20)
	assert.equal(rows[2].percentage, -20)
})

test('marca parcelas novas e ausentes sem calcular percentual enganoso', () => {
	const rows = compareFinancialActions([action(2, 70)], [action(1, 90)], 'unidade-1')
	assert.deepEqual(rows.map(({ alertType }) => alertType), ['Novo registro', 'Registro ausente'])
	assert.equal(rows[0].previousValue, undefined)
	assert.equal(rows[0].percentage, undefined)
	assert.equal(rows[1].currentValue, undefined)
	assert.equal(rows[1].percentage, undefined)
})

test('não calcula variação percentual quando o valor anterior é zero', () => {
	const rows = compareFinancialActions([action(1, 20)], [action(1, 0)], 'unidade-1')
	assert.equal(rows[0].alertType, 'Aumento')
	assert.equal(rows[0].difference, 20)
	assert.equal(rows[0].percentage, undefined)
})

test('marca dados financeiros ausentes ou identificadores ambíguos sem supor igualdade', () => {
	const rows = compareFinancialActions(
		[{ descricao: 'Sem ID', valorLiquido: 10 }, action(2, 10), action(2, 20)],
		[{ descricao: 'Sem ID', valorLiquido: 10 }, action(2, 10)],
		'unidade-1',
	)
	assert.equal(rows.filter(({ alertType }) => alertType === 'Sem dados para comparação').length, 3)
	assert.equal(financialActionIdentity({ descricao: 'Sem ID' }), undefined)
	assert.equal(financialActionValue({ id: 4, valorLiquido: '' }), undefined)
})

test('não converte falta de histórico em valor zero', () => {
	const rows = compareFinancialActions([], [], 'unidade-1')
	assert.deepEqual(rows, [])
	assert.equal(financialActionValue(action(1, '0')), 0)
})

test('preserva status local de análise e sua justificativa', () => {
	const values = new Map<string, string>()
	Object.defineProperty(globalThis, 'localStorage', {
		value: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		},
		configurable: true,
	})
	const repository = new LocalStorageInstallmentReviewRepository()
	const saved = repository.save('2026-10:unit:action-1', {
		status: 'Analisado',
		justificativa: 'Diferença validada com o município.',
		updatedAt: '2026-10-30T12:00:00.000Z',
	})
	assert.equal(saved['2026-10:unit:action-1'].status, 'Analisado')
	assert.equal(repository.load()['2026-10:unit:action-1'].justificativa, 'Diferença validada com o município.')
})
