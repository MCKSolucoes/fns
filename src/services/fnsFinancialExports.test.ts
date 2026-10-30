import assert from 'node:assert/strict'
import test from 'node:test'
import { createFinancialCsv, createFinancialPdf, createFinancialWorkbook } from './fnsFinancialExports.js'
import { getFinancialGeneralTotals } from './fnsFinancialService.js'
import type { FnsFinancialExportData } from './fnsFinancialExports.js'

function exportData(count = 1): FnsFinancialExportData {
  const actions = Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    descricao: 'Atenção à Saúde; "ação"',
    formaRepasse: 'C',
    quantidadeParcelas: '1',
    componenteBloco: { id: 97, nome: 'Componente' },
    blocoPacto: { id: 10, nome: 'Bloco' },
    grupoAcao: { id: 14, nome: 'Grupo' },
    valorTotal: 1949.7,
    valorDescontoTotal: 428,
    valorLiquido: 1521.7,
    valorTotalGeral: 164792.94,
    valorDescontoTotalGeral: 428,
    valorLiquidoGeral: 164364.94,
    totalBloco: [{ id: '1014', nome: 'Bloco', grupo: 'Grupo', valorTotal: 1949.7, valorDescontoTotal: 428, valorLiquido: 1521.7 }],
  }))
  return {
    entity: {
      razaoSocial: 'Unidade de Saúde',
      cpfCnpj: '15414921000178',
      cpfCnpjFormatado: '15.414.921/0001-78',
      municipio: 'Alfredo Marcondes',
      uf: 'SP',
    },
    filters: { ano: '2026', mes: '9', tipoConsulta: '2', cpfCnpjUg: '15414921000178' },
    response: { dados: actions, pagina: 1, itensPorPagina: count, total: count, totalPaginas: 1 },
  }
}

test('exports a UTF-8 CSV with escaped fields and general totals separate from action rows', () => {
  const data = exportData()
  data.response.pagina = 2
  data.response.total = 2
  data.response.totalPaginas = 2
  const csv = createFinancialCsv(data, new Date('2026-09-01T12:00:00.000Z'))
  assert.equal(csv.startsWith('\uFEFF'), true)
  assert.match(csv, /"Atenção à Saúde; ""ação"""/)
  assert.match(csv, /"Valor total geral";"164792,94"/)
  assert.match(csv, /"1949,7";"428";"1521,7"/)
  assert.match(csv, /"Página\(s\) exportada\(s\)";"2"/)
  assert.equal(getFinancialGeneralTotals(exportData().response.dados).net, 164364.94)
})

test('preserves original transfer-form codes and exports absent values without inventing codes', async () => {
  const data = exportData(3)
  data.response.dados[1].formaRepasse = 'P'
  data.response.dados[2].formaRepasse = undefined
  const csvRows = createFinancialCsv(data).split('\r\n')
  assert.equal(csvRows[15].split(';').at(-1), '"C"')
  assert.equal(csvRows[16].split(';').at(-1), '"P"')
  assert.equal(csvRows[17].split(';').at(-1), '""')

  const workbook = await createFinancialWorkbook(data)
  const actions = workbook.getWorksheet('Ações financeiras')
  assert.equal(actions?.getCell('I2').value, 'C')
  assert.equal(actions?.getCell('I3').value, 'P')
  assert.equal(actions?.getCell('I4').value, '')

  const pdf = await createFinancialPdf(data)
  const pdfText = pdf.output()
  assert.match(pdfText, /\(C\)/)
  assert.match(pdfText, /\(P\)/)
})

test('exports Excel with numeric money cells, identification, totals, and block summary', async () => {
  const workbook = await createFinancialWorkbook(exportData())
  const actions = workbook.getWorksheet('Ações financeiras')
  const totals = workbook.getWorksheet('Totais gerais')
  const blocks = workbook.getWorksheet('Resumo por bloco')
  assert.ok(actions)
  assert.ok(totals)
  assert.ok(blocks)
  assert.equal(actions.getCell('E2').value, 1949.7)
  assert.equal(totals.getCell('B2').value, 164792.94)
  assert.equal(blocks.getCell('A2').value, 'Bloco')
})

test('creates a multipage PDF report when many financial actions are exported', async () => {
  const pdf = await createFinancialPdf(exportData(100), new Date('2026-09-01T12:00:00.000Z'))
  assert.ok(pdf.output('arraybuffer').byteLength > 0)
  assert.ok(pdf.getNumberOfPages() > 1)
})
