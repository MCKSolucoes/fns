import assert from 'node:assert/strict'
import test from 'node:test'
import { LocalStorageFnsFinancialLaunchRepository } from './LocalStorageFnsFinancialLaunchRepository.js'
import { emptyFnsFinancialLaunchDraft, formatFnsFinancialLaunchAmount, getFnsFinancialLaunchDate, getLocalFnsFinancialLaunchDate, isValidFnsFinancialLaunchDate, parseFnsFinancialLaunchAmount } from '../utils/fnsFinancialLaunch.js'

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
    },
  })
  return {
    values,
    restore: () => {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    },
  }
}

const launch = (actionKey: string, amount = '3.151,30') => ({
  actionKey,
  status: 'Pendente' as const,
  amount,
  date: '',
  documentNumber: '',
  accountReference: '',
  responsible: '',
  observations: 'Rascunho interno com acentuação.',
})

test('saves and retrieves a local financial launch independently by action key', async () => {
  const storage = useMemoryLocalStorage()
  try {
    const repository = new LocalStorageFnsFinancialLaunchRepository()
    const first = await repository.save(launch('action-a'))
    const second = await repository.save(launch('action-b', '0,00'))

    assert.equal((await repository.getByActionKey('action-a'))?.amount, '3.151,30')
    assert.equal((await repository.getByActionKey('action-b'))?.amount, '0,00')
    assert.equal(await repository.getByActionKey('missing'), null)
    assert.notEqual(first.actionKey, second.actionKey)
    assert.equal(first.createdAt, first.updatedAt)

    const raw = [...storage.values.values()][0]
    assert.equal(raw.includes('15414921000178'), false)
    assert.equal(raw.includes('valorLiquido'), false)
  } finally {
    storage.restore()
  }
})

test('updates a saved launch while retaining its creation timestamp', async () => {
  const storage = useMemoryLocalStorage()
  try {
    const repository = new LocalStorageFnsFinancialLaunchRepository()
    const saved = await repository.save(launch('action-a'))
    const updated = await repository.update({ ...saved, status: 'Conferido', amount: '120,00' })

    assert.equal(updated.status, 'Conferido')
    assert.equal(updated.amount, '120,00')
    assert.equal(updated.createdAt, saved.createdAt)
    assert.ok(Date.parse(updated.updatedAt) >= Date.parse(saved.updatedAt))
    await assert.rejects(repository.update({ ...saved, actionKey: 'unknown' }), /não foi encontrado/)
  } finally {
    storage.restore()
  }
})

test('validates non-negative numeric amounts and calendar dates before local persistence', async () => {
  const storage = useMemoryLocalStorage()
  try {
    const repository = new LocalStorageFnsFinancialLaunchRepository()
    await assert.rejects(repository.save(launch('negative', '-1,00')), /numérico e não negativo/)
    await assert.rejects(repository.save({ ...launch('invalid-date'), date: '2026-02-30' }), /data de lançamento válida/)
    await assert.rejects(repository.save(launch('invalid-amount', 'abc')), /numérico e não negativo/)
    assert.equal(await repository.getByActionKey('negative'), null)
  } finally {
    storage.restore()
  }
})

test('parses Brazilian currency input and validates real calendar dates', () => {
  assert.equal(parseFnsFinancialLaunchAmount('3.151,30'), 3151.3)
  assert.equal(parseFnsFinancialLaunchAmount('3151,30'), 3151.3)
  assert.equal(parseFnsFinancialLaunchAmount('3151.30'), 3151.3)
  assert.equal(parseFnsFinancialLaunchAmount('-1,00'), undefined)
  assert.equal(formatFnsFinancialLaunchAmount(3151.3), '3.151,30')
  assert.equal(isValidFnsFinancialLaunchDate(''), true)
  assert.equal(isValidFnsFinancialLaunchDate('2026-09-30'), true)
  assert.equal(isValidFnsFinancialLaunchDate('2026-02-30'), false)
})

test('uses the local calendar date for new launch drafts without UTC date conversion', () => {
  const date = new Date(2026, 9, 19, 23, 59, 59)
  const expected = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  assert.equal(getLocalFnsFinancialLaunchDate(date), expected)
  assert.equal(emptyFnsFinancialLaunchDraft().date, getLocalFnsFinancialLaunchDate())
  assert.equal(getFnsFinancialLaunchDate('2026-10-18'), '2026-10-18')
  assert.equal(getFnsFinancialLaunchDate(''), getLocalFnsFinancialLaunchDate())
})

test('persists a manually selected launch date unchanged', async () => {
  const storage = useMemoryLocalStorage()
  try {
    const repository = new LocalStorageFnsFinancialLaunchRepository()
    const saved = await repository.save({ ...launch('selected-date'), date: '2026-10-19' })

    assert.equal(saved.date, '2026-10-19')
    assert.equal((await repository.getByActionKey('selected-date'))?.date, '2026-10-19')
  } finally {
    storage.restore()
  }
})
