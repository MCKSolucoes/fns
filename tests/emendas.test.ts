import assert from 'node:assert/strict'
import test from 'node:test'
import { LocalStorageBaixasRepository } from '../src/repositories/LocalStorageBaixasRepository'
import type { Baixa, EmendaEstadual, HistoricoAlteracao } from '../src/types'
import { validateEmenda } from '../src/utils/validateEmenda'

const storageKey = 'fns-repasses-demo:v1'
const entries = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
	value: {
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => entries.set(key, value),
	},
	configurable: true,
})

function clearStorage() {
	entries.clear()
}

function amendment(overrides: Partial<EmendaEstadual> = {}): EmendaEstadual {
	return { id: 'emenda-1', uf: 'SP', identificacao: '2026/123', valor: 12500, objeto: 'Custeio', ...overrides }
}

function baixa(): Baixa {
	return {
		id: 'baixa-1',
		transferId: 'repasse-1',
		beneficiary: 'Unidade de Saúde',
		paidAmount: 500,
		status: 'Pendente',
		description: '',
		createdAt: '2026-01-01T10:00:00.000Z',
		updatedAt: '2026-01-01T10:00:00.000Z',
	}
}

test('migra dados da versão 1 sem remover baixas ou eventos existentes', () => {
	clearStorage()
	const historic: HistoricoAlteracao = {
		id: 'legacy-history',
		transferId: 'repasse-1',
		baixaId: 'baixa-1',
		action: 'Baixa criada',
		timestamp: '2025-01-01T10:00:00.000Z',
		description: 'Evento legado',
	}
	const legacyBaixa = baixa()
	entries.set(storageKey, JSON.stringify({ version: 1, baixas: [legacyBaixa], history: [historic] }))

	const loaded = new LocalStorageBaixasRepository().load()

	assert.equal(loaded.version, 2)
	assert.deepEqual(loaded.baixas, [legacyBaixa])
	assert.deepEqual(loaded.history, [historic])
	assert.deepEqual(loaded.emendas, [])
})

test('cadastra, edita e exclui emendas estaduais persistidas', () => {
	clearStorage()
	const repository = new LocalStorageBaixasRepository()
	repository.load()
	repository.saveEmenda(amendment())
	const edited = amendment({ identificacao: '2026/456', valor: 26000, objeto: 'Climatização' })
	repository.saveEmenda(edited)
	assert.deepEqual(repository.load().emendas, [edited])

	repository.deleteEmenda(edited)
	assert.deepEqual(repository.load().emendas, [])
})

test('valida UF, identificação, valor, finalidade e duplicidade por UF', () => {
	const valid = amendment()
	assert.equal(validateEmenda(valid, []), '')
	assert.match(validateEmenda(amendment({ uf: 'XX' }), []), /UF brasileira/)
	assert.match(validateEmenda(amendment({ identificacao: ' ' }), []), /identificação/)
	assert.match(validateEmenda(amendment({ valor: 0 }), []), /maior que zero/)
	assert.match(validateEmenda(amendment({ objeto: ' ' }), []), /objeto/)
	assert.match(validateEmenda(amendment({ id: 'emenda-2', identificacao: '2026/123' }), [valid]), /Já existe/)
})

test('registra deputado e identificação da emenda como snapshot permanente do histórico', () => {
	clearStorage()
	const repository = new LocalStorageBaixasRepository()
	repository.load()
	const originalAmendment = amendment()
	repository.saveEmenda(originalAmendment)
	repository.save(baixa(), undefined, 'Deputada Ana Souza', originalAmendment)
	const savedBaixa = repository.load().baixas[0]

	const editedAmendment = amendment({ identificacao: '2026/999', uf: 'RJ' })
	repository.saveEmenda(editedAmendment)
	repository.deleteEmenda(editedAmendment)
	const history = repository.load().history[0]

	assert.equal(savedBaixa.deputadoResponsavel, 'Deputada Ana Souza')
	assert.equal(savedBaixa.emendaIdentificacao, 'SP · 2026/123')
	assert.deepEqual(savedBaixa.emendaSnapshot, {
		id: originalAmendment.id,
		uf: 'SP',
		identificacao: '2026/123',
		valor: 12500,
		objeto: 'Custeio',
	})
	assert.equal(history.deputadoResponsavel, 'Deputada Ana Souza')
	assert.equal(history.emendaId, originalAmendment.id)
	assert.equal(history.emendaIdentificacao, 'SP · 2026/123')
	assert.deepEqual(history.emendaSnapshot, savedBaixa.emendaSnapshot)
	assert.equal(history.baixaSnapshot?.deputadoResponsavel, 'Deputada Ana Souza')
	assert.equal(history.baixaSnapshot?.beneficiary, 'Unidade de Saúde')
})
