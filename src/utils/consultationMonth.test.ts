import assert from 'node:assert/strict'
import test from 'node:test'
import { formatConsultationMonth } from './consultationMonth.js'

const months = [
  { descricao: 'Janeiro', valor: 1 },
  { descricao: 'Setembro', valor: 9 },
  { descricao: 'Dezembro', valor: 12 },
]

test('formats selected numeric months using the FNS month label', () => {
  assert.equal(formatConsultationMonth('9', months), 'Setembro (9)')
})

test('shows Todos when no month filter was selected', () => {
  assert.equal(formatConsultationMonth('', months), 'Todos')
})

test('formats a valid numeric month when month resources are unavailable', () => {
  assert.equal(formatConsultationMonth('3', []), 'Março (3)')
})

test('does not invent a label for invalid month values', () => {
  assert.equal(formatConsultationMonth('0', months), '—')
  assert.equal(formatConsultationMonth('unknown', months), '—')
})
