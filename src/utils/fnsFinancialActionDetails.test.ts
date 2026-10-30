import assert from 'node:assert/strict'
import test from 'node:test'
import type { FnsFinancialAction } from '../types/fnsFinancial.js'
import { formatFnsFinancialActionDetail, getFnsFinancialActionDetails } from './fnsFinancialActionDetails.js'

test('maps Alfredo Marcondes action fields without including consultation or block aggregates', () => {
  const action: FnsFinancialAction = {
    id: 68722,
    descricao: 'CBAF - RECURSOS FINANCEIROS A TRANSFERIR',
    sigla: '',
    nomeResumido: '',
    formaRepasse: 'C',
    quantidadeParcelas: '1',
    componenteBloco: { id: 119, nome: 'Promoção da Assistência Farmacêutica' },
    blocoPacto: { id: 10, nome: 'Manutenção das Ações e Serviços Públicos de Saúde' },
    grupoAcao: { id: 35, nome: 'Assistência Farmacêutica' },
    valorTotal: 3151.3,
    valorDescontoTotal: 0,
    valorLiquido: 3151.3,
    valorTotalGeral: 164792.94,
    valorDescontoTotalGeral: 428,
    valorLiquidoGeral: 164364.94,
    totalBloco: [{ id: '1035', nome: 'Manutenção das Ações e Serviços Públicos de Saúde', grupo: 'Assistência Farmacêutica' }],
  }

  const details = getFnsFinancialActionDetails(action)
  const byLabel = Object.fromEntries(details.map(({ label, value }) => [label, value]))

  assert.equal(byLabel['ID da ação'], 68722)
  assert.equal(byLabel['Componente do bloco'], 'Promoção da Assistência Farmacêutica')
  assert.equal(byLabel['ID do componente do bloco'], 119)
  assert.equal(byLabel['Bloco de pacto'], 'Manutenção das Ações e Serviços Públicos de Saúde')
  assert.equal(byLabel['ID do bloco de pacto'], 10)
  assert.equal(byLabel['Grupo da ação'], 'Assistência Farmacêutica')
  assert.equal(byLabel['ID do grupo da ação'], 35)
  assert.equal(byLabel['Nome resumido'], '')
  assert.equal(byLabel.Sigla, '')
  assert.equal(byLabel['Valor total'], 3151.3)
  assert.equal(byLabel['Valor total de descontos'], 0)
  assert.equal(byLabel['Valor líquido'], 3151.3)
  assert.equal(details.some(({ key }) => ['valorTotalGeral', 'valorDescontoTotalGeral', 'valorLiquidoGeral', 'totalBloco'].includes(key)), false)
  assert.equal(details.some(({ value }) => typeof value === 'object' && value !== null), false)
})

test('keeps each selected action independent and displays absent summary fields as dashes', () => {
  const first: FnsFinancialAction = { id: 1, descricao: 'Ação um', valorTotal: 3151.3, nomeResumido: '', sigla: '' }
  const second: FnsFinancialAction = { id: 2, descricao: 'Ação dois', valorTotal: 12.5, nomeResumido: undefined }

  const firstDetails = getFnsFinancialActionDetails(first)
  const secondDetails = getFnsFinancialActionDetails(second)
  const find = (items: typeof firstDetails, key: string) => items.find((item) => item.key === key)?.value

  assert.equal(find(firstDetails, 'valorTotal'), 3151.3)
  assert.equal(find(secondDetails, 'valorTotal'), 12.5)
  assert.equal(formatFnsFinancialActionDetail(find(firstDetails, 'nomeResumido'), false), '—')
  assert.equal(formatFnsFinancialActionDetail(find(firstDetails, 'sigla'), false), '—')
  assert.equal(formatFnsFinancialActionDetail(find(secondDetails, 'nomeResumido'), false), '—')
  assert.equal(formatFnsFinancialActionDetail(find(secondDetails, 'sigla'), false), '—')
})

test('preserves transfer-form codes in details and renders empty values as a dash', () => {
  for (const code of ['C', 'P']) {
    const details = getFnsFinancialActionDetails({ id: 1, formaRepasse: code })
    const formaRepasse = details.find(({ key }) => key === 'formaRepasse')
    assert.equal(formaRepasse?.label, 'Forma de repasse')
    assert.equal(formatFnsFinancialActionDetail(formaRepasse?.value, false), code)
  }
  for (const value of ['', null, undefined]) {
    const details = getFnsFinancialActionDetails({ id: 1, formaRepasse: value })
    assert.equal(formatFnsFinancialActionDetail(details.find(({ key }) => key === 'formaRepasse')?.value, false), '—')
  }
})

test('formats monetary amounts as Brazilian reais and does not mutate original values', () => {
  const original = '3151.30'

  assert.equal(formatFnsFinancialActionDetail(original, true), 'R$ 3.151,30')
  assert.equal(original, '3151.30')
  assert.equal(formatFnsFinancialActionDetail(undefined, false), '—')
  assert.equal(formatFnsFinancialActionDetail({ nome: 'Bloco' }, false), '—')
})
