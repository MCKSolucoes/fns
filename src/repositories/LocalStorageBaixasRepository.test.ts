import assert from 'node:assert/strict'
import test from 'node:test'
import { LocalStorageBaixasRepository } from './LocalStorageBaixasRepository.js'

function useMemoryLocalStorage() {
  const values = new Map<string, string>()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size },
    },
  })
  return () => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

test('saves and restores internal financial complements through the existing local repository', () => {
  const restoreStorage = useMemoryLocalStorage()
  try {
    const repository = new LocalStorageBaixasRepository()
    const before = repository.load()
    const key = '["15414921000178","3500800","SP","2026","9","2"]'
    const saved = repository.saveFinancialComplement(key, {
      observations: 'Conferir documento da parcela.',
      reviewStatus: 'Em conferência',
      reviewResponsible: 'Equipe Financeira',
      internalReference: 'PROTO-2026-09',
    })

    assert.equal(saved.observations, 'Conferir documento da parcela.')
    assert.ok(Number.isFinite(Date.parse(saved.updatedAt)))

    const reopened = new LocalStorageBaixasRepository().getFinancialComplement(key)
    assert.deepEqual(reopened, saved)

    const persisted = new LocalStorageBaixasRepository().load()
    assert.deepEqual(persisted.baixas, before.baixas)
    assert.deepEqual(persisted.history, before.history)
    assert.equal('valorTotal' in saved, false)
    assert.equal('descricao' in saved, false)
  } finally {
    restoreStorage()
  }
})

test('keeps older local demo data compatible and validates internal-only fields', () => {
  const restoreStorage = useMemoryLocalStorage()
  try {
    const repository = new LocalStorageBaixasRepository()
    const key = 'financial-consultation'
    assert.equal(repository.getFinancialComplement(key), null)
    assert.throws(() => repository.saveFinancialComplement(key, {
      observations: 'x'.repeat(2001),
      reviewStatus: '',
      reviewResponsible: '',
      internalReference: '',
    }), /no máximo 2\.000 caracteres/)
    assert.equal(repository.getFinancialComplement(key), null)
  } finally {
    restoreStorage()
  }
})

test('preserves invalid local data and reports it instead of replacing it with demo records', () => {
  const restoreStorage = useMemoryLocalStorage()
  try {
    const original = '{"version":2,"baixas":[{"id":"kept-but-invalid"}],"history":[],"emendas":[]}'
    localStorage.setItem('fns-repasses-demo:v1', original)
    assert.throws(() => new LocalStorageBaixasRepository().load(), /conteúdo original foi preservado/)
    assert.equal(localStorage.getItem('fns-repasses-demo:v1'), original)
  } finally {
    restoreStorage()
  }
})
