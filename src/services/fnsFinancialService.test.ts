import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAllFnsFinancialPages,
  clearFnsFinancialPageCache,
  getFinancialBlockSummary,
  getFinancialGeneralTotals,
  getFnsFinancialPage,
  filterFnsFinancialActions,
  isRelevantFnsFinancialAction,
  mergeFnsFinancialAggregates,
} from './fnsFinancialService.js'

const filters = {
  ano: '2026',
  count: 100,
  cpfCnpjUg: '15414921000178',
  estado: 'SP',
  mes: '9',
  municipio: '3500808',
  page: 1,
  tipoConsulta: '2',
}

function payload(page: number, totalPages = 1, total = 1) {
  return {
    dados: Array.from({ length: page === totalPages ? total - (page - 1) * 100 : 100 }, (_, index) => ({
      id: `${page}-${index}`,
      descricao: 'Ação oficial',
    })),
    pagina: page,
    itensPorPagina: 100,
    total,
    totalPaginas: totalPages,
  }
}

test('reads consultation totals and block totals as aggregates without summing them into actions', () => {
  const actions = [
    { id: 68722, valorTotal: 3151.3, valorDescontoTotal: 0, valorLiquido: 3151.3 },
    {
      id: 68723,
      valorTotal: 1949.7,
      valorDescontoTotal: 428,
      valorLiquido: 1521.7,
      valorTotalGeral: 164792.94,
      valorDescontoTotalGeral: 428,
      valorLiquidoGeral: 164364.94,
      totalBloco: [
        {
          id: '1014',
          nome: 'Manutenção das Ações e Serviços Públicos de Saúde',
          grupo: 'Atenção de Média e Alta Complexidade Ambulatorial e Hospitalar',
          valorTotal: 1949.7,
          valorDescontoTotal: 428,
          valorLiquido: 1521.7,
        },
      ],
    },
    {
      id: 68724,
      valorTotal: 100,
      valorTotalGeral: 164792.94,
      totalBloco: [{ id: '1014', valorTotal: 1949.7 }],
    },
  ]

  assert.deepEqual(getFinancialGeneralTotals(actions), {
    total: 164792.94,
    discounts: 428,
    net: 164364.94,
  })
  assert.deepEqual(getFinancialBlockSummary(actions), [actions[1].totalBloco[0]])
  assert.equal(actions[0].valorTotal, 3151.3)
})

test('filters empty and aggregate-only rows while retaining identified zero-value actions', () => {
  const actionRows = [
    {},
    {
      id: 0,
      descricao: '',
      sigla: '',
      nomeResumido: '',
      formaRepasse: '',
      quantidadeParcelas: '',
      componenteBloco: { id: 0 },
      blocoPacto: { id: 11, nome: 'Estruturação da Rede de Serviços Públicos de Saúde' },
      grupoAcao: { id: 19, nome: 'Atenção Especializada' },
      valorTotal: 0,
      valorDescontoTotal: 0,
      valorLiquido: 0,
      valorTotalGeral: 164792.94,
      totalBloco: [{ id: '1014', valorTotal: 1949.7 }],
    },
    { id: '0', descricao: '', valorTotal: 0, valorLiquido: 0 },
    { id: 123, descricao: 'Ação identificada sem valores financeiros', valorTotal: 0, valorLiquido: 0 },
    { descricao: 'Ação identificada por descrição', valorTotal: 0 },
    { valorTotal: 3151.3, valorLiquido: 3151.3 },
    { id: 456 },
  ]

  assert.deepEqual(filterFnsFinancialActions(actionRows), actionRows.slice(3))
  assert.equal(isRelevantFnsFinancialAction(actionRows[3]), true)
  assert.equal(isRelevantFnsFinancialAction(actionRows[5]), true)
  assert.equal(isRelevantFnsFinancialAction(actionRows[6]), true)
})

test('filters invalid rows and recalculates known financial pagination without mutating API records', async () => {
  clearFnsFinancialPageCache()
  const originalFetch = globalThis.fetch
  const validActions = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    descricao: `Ação ${index + 1}`,
    valorTotal: index === 0 ? 0 : 100,
    ...(index === 0 ? {
      valorTotalGeral: 164792.94,
      valorDescontoTotalGeral: 428,
      valorLiquidoGeral: 164364.94,
      totalBloco: [{ id: '1014', nome: 'Bloco', grupo: 'Grupo', valorTotal: 3151.3 }],
    } : {}),
  }))
  const placeholders = Array.from({ length: 7 }, (_, index) => ({
    id: 0,
    descricao: '',
    sigla: '',
    nomeResumido: '',
    formaRepasse: '',
    quantidadeParcelas: '',
    componenteBloco: { id: 0 },
    blocoPacto: { id: 11, nome: 'Estruturação da Rede de Serviços Públicos de Saúde' },
    grupoAcao: { id: 19, nome: 'Atenção Especializada' },
    valorTotal: 0,
    valorDescontoTotal: 0,
    valorLiquido: 0,
    ...(index === 0 ? { valorTotalGeral: 164792.94, totalBloco: [{ id: '1014', valorTotal: 1949.7 }] } : {}),
  }))
  const requestedPages: number[] = []
  globalThis.fetch = async (input) => {
    const page = Number(new URL(String(input), 'http://localhost').searchParams.get('page'))
    requestedPages.push(page)
    return Response.json({
      dados: page === 1 ? validActions : placeholders,
      pagina: page,
      itensPorPagina: 10,
      total: 17,
      totalPaginas: 2,
    })
  }

  try {
    const firstPage = await getFnsFinancialPage({ ...filters, count: 10 })
    assert.equal(firstPage.dados.length, 10)
    assert.equal(firstPage.total, 17)
    assert.equal(firstPage.totalPaginas, 2)
    assert.deepEqual(getFinancialGeneralTotals(firstPage.dados), {
      total: 164792.94,
      discounts: 428,
      net: 164364.94,
    })
    assert.deepEqual(getFinancialBlockSummary(firstPage.dados), validActions[0].totalBloco)

    const secondPage = await getFnsFinancialPage({ ...filters, count: 10, page: 2 })
    assert.equal(secondPage.dados.length, 0)
    assert.equal(secondPage.total, 10)
    assert.equal(secondPage.totalPaginas, 1)
    assert.equal(firstPage.total, 10)
    assert.equal(firstPage.totalPaginas, 1)
    assert.equal(validActions[0].valorTotal, 0)
    assert.deepEqual(requestedPages, [1, 2])
  } finally {
    globalThis.fetch = originalFetch
    clearFnsFinancialPageCache()
  }
})

test('retains query aggregates across action pages without carrying them to another entity', () => {
  const pageOneActions = [{
    id: 1,
    valorTotal: 3151.3,
    valorTotalGeral: 164792.94,
    valorDescontoTotalGeral: 428,
    valorLiquidoGeral: 164364.94,
    totalBloco: [{ id: 'b1', nome: 'Bloco', grupo: 'Grupo', valorTotal: 3151.3 }],
  }]
  const pageTwoActions = [{ id: 2, valorTotal: 1949.7 }]
  const firstPage = mergeFnsFinancialAggregates(null, 'entity-a', pageOneActions)
  const secondPage = mergeFnsFinancialAggregates(firstPage, 'entity-a', pageTwoActions)
  const otherEntity = mergeFnsFinancialAggregates(secondPage, 'entity-b', pageTwoActions)

  assert.deepEqual(secondPage.totals, {
    total: 164792.94,
    discounts: 428,
    net: 164364.94,
  })
  assert.deepEqual(secondPage.blocks, pageOneActions[0].totalBloco)
  assert.deepEqual(otherEntity.totals, { total: undefined, discounts: undefined, net: undefined })
  assert.deepEqual(otherEntity.blocks, [])
})

test('sends the selected entity and query parameters to the financial API', async () => {
  clearFnsFinancialPageCache()
  const originalFetch = globalThis.fetch
  let requestedUrl = ''
  globalThis.fetch = async (input) => {
    requestedUrl = String(input)
    return Response.json(payload(1))
  }
  try {
    await getFnsFinancialPage(filters)
  } finally {
    globalThis.fetch = originalFetch
    clearFnsFinancialPageCache()
  }
  const url = new URL(requestedUrl, 'http://localhost')
  assert.equal(url.pathname, '/api/fns/detalhe-acao')
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    ano: '2026',
    count: '100',
    cpfCnpjUg: '15414921000178',
    estado: 'SP',
    mes: '9',
    municipio: '3500808',
    page: '1',
    tipoConsulta: '2',
  })
})

test('requests the selected financial page size and returns only valid actions for each page', async () => {
  clearFnsFinancialPageCache()
  const originalFetch = globalThis.fetch
  const actions = Array.from({ length: 17 }, (_, index) => ({
    id: index + 1,
    descricao: `Ação ${index + 1}`,
    valorTotal: index === 0 ? 0 : index * 100,
  }))
  const requested = new Set<string>()
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost')
    const count = Number(url.searchParams.get('count'))
    const page = Number(url.searchParams.get('page'))
    requested.add(`${page}-${count}`)
    const pageActions = actions.slice((page - 1) * count, page * count)
    return Response.json({
      dados: pageActions,
      pagina: page,
      itensPorPagina: count,
      total: actions.length,
      totalPaginas: Math.ceil(actions.length / count),
    })
  }

  try {
    const firstTen = await getFnsFinancialPage({ ...filters, count: 10, page: 1 })
    assert.equal(firstTen.dados.length, 10)
    assert.equal(firstTen.total, 17)
    assert.equal(firstTen.totalPaginas, 2)
    const secondTen = await getFnsFinancialPage({ ...filters, count: 10, page: 2 })
    assert.equal(secondTen.dados.length, 7)
    assert.equal(secondTen.totalPaginas, 2)

    const twentyFive = await getFnsFinancialPage({ ...filters, count: 25, page: 1 })
    assert.equal(twentyFive.dados.length, 17)
    assert.equal(twentyFive.totalPaginas, 1)
    const fifty = await getFnsFinancialPage({ ...filters, count: 50, page: 1 })
    assert.equal(fifty.dados.length, 17)
    assert.equal(fifty.totalPaginas, 1)
    assert.equal(firstTen.dados[0].valorTotal, 0)
    assert.deepEqual([...requested].sort(), ['1-10', '1-25', '1-50', '2-10'])
  } finally {
    globalThis.fetch = originalFetch
    clearFnsFinancialPageCache()
  }
})

test('loads every financial page and verifies the final record count', async () => {
  clearFnsFinancialPageCache()
  const originalFetch = globalThis.fetch
  const requestedPages: number[] = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost')
    const page = Number(url.searchParams.get('page'))
    requestedPages.push(page)
    return Response.json(payload(page, 2, 101))
  }
  try {
    const result = await getAllFnsFinancialPages({
      ano: filters.ano,
      cpfCnpjUg: filters.cpfCnpjUg,
      estado: filters.estado,
      mes: filters.mes,
      municipio: filters.municipio,
      tipoConsulta: filters.tipoConsulta,
    }, new AbortController().signal, () => {})
    assert.deepEqual(requestedPages, [1, 2])
    assert.equal(result.dados.length, 101)
    assert.equal(result.total, 101)
  } finally {
    globalThis.fetch = originalFetch
    clearFnsFinancialPageCache()
  }
})

test('does not return a partial export when financial pagination metadata changes', async () => {
  clearFnsFinancialPageCache()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const page = Number(new URL(String(input), 'http://localhost').searchParams.get('page'))
    return Response.json(page === 1 ? payload(1, 2, 101) : { ...payload(2, 3, 101), pagina: 2 })
  }
  try {
    await assert.rejects(
      getAllFnsFinancialPages({ cpfCnpjUg: filters.cpfCnpjUg }, new AbortController().signal, () => {}),
      /paginação dos dados financeiros mudou/,
    )
  } finally {
    globalThis.fetch = originalFetch
    clearFnsFinancialPageCache()
  }
})

test('reuses pending and successful responses only for identical complete financial filters', async () => {
  clearFnsFinancialPageCache()
  const originalFetch = globalThis.fetch
  let requests = 0
  let releaseRequest!: (response: Response) => void
  globalThis.fetch = async () => {
    requests += 1
    if (requests === 1) return new Promise<Response>((resolve) => { releaseRequest = resolve })
    return Response.json(payload(1))
  }
  try {
    const firstPending = getFnsFinancialPage({ ...filters, count: 10 })
    const duplicatePending = getFnsFinancialPage({ ...filters, count: 10 })
    assert.equal(requests, 1)
    releaseRequest(Response.json(payload(1)))
    const [first, duplicate] = await Promise.all([firstPending, duplicatePending])
    assert.equal(first, duplicate)
    assert.equal((await getFnsFinancialPage({ ...filters, count: 10 })), first)
    assert.equal(requests, 1)

    await getFnsFinancialPage({ ...filters, count: 10, cpfCnpjUg: '99999999000199' })
    await getFnsFinancialPage({ ...filters, count: 10, page: 2 })
    assert.equal(requests, 3)
  } finally {
    globalThis.fetch = originalFetch
    clearFnsFinancialPageCache()
  }
})

test('does not cache failed financial requests and allows retry', async () => {
  clearFnsFinancialPageCache()
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return requests === 1
      ? Response.json({ error: { message: 'Temporarily unavailable', retryable: true } }, { status: 503 })
      : Response.json(payload(1))
  }
  try {
    await assert.rejects(getFnsFinancialPage({ ...filters, count: 10 }), /Temporarily unavailable/)
    const result = await getFnsFinancialPage({ ...filters, count: 10 })
    assert.equal(result.dados.length, 1)
    assert.equal(requests, 2)
  } finally {
    globalThis.fetch = originalFetch
    clearFnsFinancialPageCache()
  }
})

test('aborting one consumer does not cancel a shared pending request for another consumer', async () => {
  clearFnsFinancialPageCache()
  const originalFetch = globalThis.fetch
  let releaseRequest!: (response: Response) => void
  globalThis.fetch = async () => new Promise<Response>((resolve) => { releaseRequest = resolve })
  const controller = new AbortController()
  try {
    const abortedConsumer = getFnsFinancialPage({ ...filters, count: 10 }, controller.signal)
    const activeConsumer = getFnsFinancialPage({ ...filters, count: 10 })
    controller.abort()
    await assert.rejects(abortedConsumer, { name: 'AbortError' })
    releaseRequest(Response.json(payload(1)))
    assert.equal((await activeConsumer).dados.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    clearFnsFinancialPageCache()
  }
})
