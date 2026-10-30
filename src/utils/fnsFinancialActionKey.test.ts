import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConsultationFilters } from '../types/index.js'
import type { FnsFinancialAction, FnsFinancialEntity } from '../types/fnsFinancial.js'
import { createFnsFinancialActionKey } from './fnsFinancialActionKey.js'

const filters: ConsultationFilters = {
  year: '2026',
  month: '9',
  queryType: '2',
  block: '',
  group: '',
  document: '',
  state: 'SP',
  city: 'Alfredo Marcondes',
  cityCode: '3500800',
  processNumber: '',
  proposal: '',
  transferType: '',
  dateFrom: '',
  dateTo: '',
  portaria: '',
}

const entity: FnsFinancialEntity = {
  cpfCnpj: '15414921000178',
  codigoMunicipioIBGE: '3500800',
  municipio: 'ALFREDO MARCONDES',
  uf: 'SP',
}

test('creates a stable opaque key scoped to entity, municipality, query filters and action ID', async () => {
  const action: FnsFinancialAction = { id: 68722, descricao: 'Ação oficial' }
  const key = await createFnsFinancialActionKey(entity, filters, action)

  assert.equal(key, await createFnsFinancialActionKey(entity, filters, action))
  assert.match(key, /^[a-f0-9]{64}$/)
  assert.equal(key.includes('15414921000178'), false)
  assert.notEqual(key, await createFnsFinancialActionKey({ ...entity, cpfCnpj: '99999999000199' }, filters, action))
  assert.notEqual(key, await createFnsFinancialActionKey(entity, { ...filters, cityCode: '3500801' }, action))
  assert.notEqual(key, await createFnsFinancialActionKey(entity, { ...filters, month: '10' }, action))
  assert.notEqual(key, await createFnsFinancialActionKey(entity, filters, { ...action, id: 61659 }))
})

test('uses additional official action identifiers when action ID is absent', async () => {
  const first = await createFnsFinancialActionKey(entity, filters, {
    descricao: 'Ação sem ID',
    componenteBloco: { id: 119 },
  })
  const same = await createFnsFinancialActionKey(entity, filters, {
    descricao: 'Ação sem ID',
    componenteBloco: { id: 119 },
  })
  const other = await createFnsFinancialActionKey(entity, filters, {
    descricao: 'Ação sem ID',
    componenteBloco: { id: 120 },
  })

  assert.equal(first, same)
  assert.notEqual(first, other)
})
