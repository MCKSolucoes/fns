import type ExcelJS from 'exceljs'
import type { jsPDF } from 'jspdf'
import type { FnsFinancialEntity, FnsFinancialFilters, FnsFinancialResponse } from '../types/fnsFinancial'
import { getFinancialBlockSummary, getFinancialGeneralTotals } from './fnsFinancialService'

const ACTION_COLUMNS = [
  { header: 'Descrição da ação', key: 'descricao', width: 48 },
  { header: 'Bloco de pacto', key: 'blocoPacto', width: 34 },
  { header: 'Grupo da ação', key: 'grupoAcao', width: 36 },
  { header: 'Componente do bloco', key: 'componenteBloco', width: 48 },
  { header: 'Valor total', key: 'valorTotal', width: 17 },
  { header: 'Descontos', key: 'valorDescontoTotal', width: 17 },
  { header: 'Valor líquido', key: 'valorLiquido', width: 17 },
  { header: 'Quantidade de parcelas', key: 'quantidadeParcelas', width: 20 },
  { header: 'Forma de repasse', key: 'formaRepasse', width: 18 },
] as const

export interface FnsFinancialExportData {
  entity: FnsFinancialEntity
  filters: Omit<FnsFinancialFilters, 'page' | 'count'>
  response: FnsFinancialResponse
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(display).filter(Boolean).join(', ')
  if (typeof value === 'object' && 'nome' in value && typeof value.nome === 'string') return value.nome
  return JSON.stringify(value)
}

function numeric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value)
  return undefined
}

export function createFinancialCsv(data: FnsFinancialExportData, exportedAt = new Date()): string {
  const totals = getFinancialGeneralTotals(data.response.dados)
  const rows: unknown[][] = [
    ['Dados financeiros do FNS'],
    ['Entidade', display(data.entity.razaoSocial)],
    ['CNPJ', display(data.entity.cpfCnpjFormatado ?? data.entity.cpfCnpj)],
    ['Município', display(data.entity.municipio)],
    ['UF', display(data.entity.uf)],
    ['Ano', data.filters.ano ?? ''],
    ['Mês', data.filters.mes ?? ''],
    ['Tipo de consulta', data.filters.tipoConsulta ?? ''],
    ['Exportado em', exportedAt.toLocaleString('pt-BR')],
    ['Valor total geral', totals.total ?? ''],
    ['Total de descontos', totals.discounts ?? ''],
    ['Valor líquido geral', totals.net ?? ''],
    ['Página(s) exportada(s)', exportedPages(data.response)],
    [],
    ACTION_COLUMNS.map((column) => column.header),
    ...data.response.dados.map((action) => ACTION_COLUMNS.map((column) =>
      ['valorTotal', 'valorDescontoTotal', 'valorLiquido'].includes(column.key)
        ? numeric(action[column.key])
        : display(action[column.key]),
    )),
  ]
  const quote = (value: unknown) => {
    const text = typeof value === 'number' ? value.toLocaleString('pt-BR', { useGrouping: false }) : String(value ?? '')
    return `"${text.replaceAll('"', '""')}"`
  }
  return `\uFEFF${rows.map((row) => row.map(quote).join(';')).join('\r\n')}`
}

export async function createFinancialWorkbook(data: FnsFinancialExportData, exportedAt = new Date()): Promise<ExcelJS.Workbook> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'FNS Gestão'
  workbook.created = exportedAt

  const identification = workbook.addWorksheet('Identificação')
  identification.addRows([
    ['Dados financeiros do FNS'],
    ['Entidade', display(data.entity.razaoSocial)],
    ['CNPJ', display(data.entity.cpfCnpjFormatado ?? data.entity.cpfCnpj)],
    ['Município', display(data.entity.municipio)],
    ['UF', display(data.entity.uf)],
    ['Código do município IBGE', display(data.entity.codigoMunicipioIBGE)],
    ['Ano', data.filters.ano ?? ''],
    ['Mês', data.filters.mes ?? ''],
    ['Tipo de consulta', data.filters.tipoConsulta ?? ''],
    ['Estado', data.filters.estado ?? ''],
    ['Município consultado', data.filters.municipio ?? ''],
    ['CPF/CNPJ/UG', data.filters.cpfCnpjUg],
    ['Página(s) exportada(s)', exportedPages(data.response)],
    ['Ações exportadas', data.response.dados.length],
    ['Exportado em', exportedAt.toLocaleString('pt-BR')],
  ])
  identification.getColumn(1).width = 28
  identification.getColumn(2).width = 56
  identification.getRow(1).font = { bold: true, size: 16 }

  const actionsSheet = workbook.addWorksheet('Ações financeiras')
  actionsSheet.columns = ACTION_COLUMNS.map(({ header, key, width }) => ({ header, key, width }))
  for (const action of data.response.dados) {
    actionsSheet.addRow({
      descricao: display(action.descricao),
      blocoPacto: display(action.blocoPacto),
      grupoAcao: display(action.grupoAcao),
      componenteBloco: display(action.componenteBloco),
      valorTotal: numeric(action.valorTotal) ?? null,
      valorDescontoTotal: numeric(action.valorDescontoTotal) ?? null,
      valorLiquido: numeric(action.valorLiquido) ?? null,
      quantidadeParcelas: display(action.quantidadeParcelas),
      formaRepasse: display(action.formaRepasse),
    })
  }
  actionsSheet.getRow(1).font = { bold: true }
  actionsSheet.views = [{ state: 'frozen', ySplit: 1 }]
  for (const column of ['E', 'F', 'G']) {
    actionsSheet.getColumn(column).numFmt = '#,##0.00'
  }

  const totals = getFinancialGeneralTotals(data.response.dados)
  if (totals.total !== undefined || totals.discounts !== undefined || totals.net !== undefined) {
    const summary = workbook.addWorksheet('Totais gerais')
    summary.addRows([
      ['Indicador', 'Valor'],
      ['Valor total geral', totals.total ?? null],
      ['Total de descontos', totals.discounts ?? null],
      ['Valor líquido geral', totals.net ?? null],
    ])
    summary.getRow(1).font = { bold: true }
    summary.getColumn(1).width = 28
    summary.getColumn(2).width = 20
    summary.getColumn(2).numFmt = '#,##0.00'
  }

  const blocks = getFinancialBlockSummary(data.response.dados)
  if (blocks.length) {
    const blocksSheet = workbook.addWorksheet('Resumo por bloco')
    blocksSheet.columns = [
      { header: 'Nome do bloco', key: 'nome', width: 44 },
      { header: 'Grupo', key: 'grupo', width: 44 },
      { header: 'Valor total', key: 'valorTotal', width: 20 },
      { header: 'Descontos', key: 'valorDescontoTotal', width: 20 },
      { header: 'Valor líquido', key: 'valorLiquido', width: 20 },
    ]
    for (const block of blocks) {
      blocksSheet.addRow({
        nome: display(block.nome),
        grupo: display(block.grupo),
        valorTotal: numeric(block.valorTotal) ?? null,
        valorDescontoTotal: numeric(block.valorDescontoTotal) ?? null,
        valorLiquido: numeric(block.valorLiquido) ?? null,
      })
    }
    blocksSheet.getRow(1).font = { bold: true }
    for (const column of ['C', 'D', 'E']) blocksSheet.getColumn(column).numFmt = '#,##0.00'
  }
  return workbook
}

export async function createFinancialPdf(data: FnsFinancialExportData, exportedAt = new Date()): Promise<jsPDF> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const document = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const entityName = display(data.entity.razaoSocial)
  const cnpj = display(data.entity.cpfCnpjFormatado ?? data.entity.cpfCnpj)
  const location = [display(data.entity.municipio), display(data.entity.uf)].filter(Boolean).join(' / ')
  const totals = getFinancialGeneralTotals(data.response.dados)
  document.setFontSize(16)
  document.text('Dados financeiros do FNS', 14, 16)
  document.setFontSize(10)
  document.text(`Entidade: ${entityName}`, 14, 24)
  document.text(`CNPJ: ${cnpj}   Município/UF: ${location}`, 14, 30)
  document.text(`Ano: ${data.filters.ano ?? '—'}   Mês: ${data.filters.mes ?? '—'}   Tipo: ${data.filters.tipoConsulta ?? '—'}`, 14, 36)
  document.text(`Página(s) exportada(s): ${exportedPages(data.response)}`, 14, 42)
  document.text(`Exportado em: ${exportedAt.toLocaleString('pt-BR')}`, 14, 48)
  const indicators = [
    ['Valor total geral', totals.total],
    ['Total de descontos', totals.discounts],
    ['Valor líquido geral', totals.net],
  ].filter((item): item is [string, number] => item[1] !== undefined)
  if (indicators.length) {
    document.text(indicators.map(([label, value]) => `${label}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}`).join('    '), 14, 55)
  }
  autoTable(document, {
    startY: indicators.length ? 62 : 55,
    head: [ACTION_COLUMNS.map((column) => column.header)],
    body: data.response.dados.map((action) => ACTION_COLUMNS.map((column) => {
      const value = action[column.key]
      if (['valorTotal', 'valorDescontoTotal', 'valorLiquido'].includes(column.key)) {
        const amount = numeric(value)
        return amount === undefined ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
      }
      return display(value) || '—'
    })),
    styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [57, 93, 62] },
    margin: { left: 14, right: 14 },
    showHead: 'everyPage',
  })
  return document
}

function exportedPages(response: FnsFinancialResponse): string {
  return response.dados.length === response.total
    ? response.totalPaginas === 0 ? '0' : `1-${response.totalPaginas}`
    : String(response.pagina)
}

export async function downloadFinancialExport(
  format: 'csv' | 'xlsx' | 'pdf',
  data: FnsFinancialExportData,
): Promise<void> {
  const filename = `dados-financeiros-fns-${Date.now()}`
  let blob: Blob
  let extension: string
  if (format === 'csv') {
    blob = new Blob([createFinancialCsv(data)], { type: 'text/csv;charset=utf-8' })
    extension = 'csv'
  } else if (format === 'xlsx') {
    const buffer = await (await createFinancialWorkbook(data)).xlsx.writeBuffer()
    blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    extension = 'xlsx'
  } else {
    blob = (await createFinancialPdf(data)).output('blob')
    extension = 'pdf'
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${filename}.${extension}`
  anchor.click()
  URL.revokeObjectURL(url)
}
