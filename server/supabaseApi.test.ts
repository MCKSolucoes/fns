import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from './app.js'
import { loadConfig, type ServerConfig } from './config.js'

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 3001,
  frontendOrigin: 'http://127.0.0.1:5173',
  fnsTimeoutMs: 1000,
  supabaseUrl: 'https://project.supabase.co',
  supabaseAnonKey: 'public-anon-key',
}
const logger = { info() {}, error() {} }

test('mutation origin guard accepts equivalent local hosts without accepting other origins', async () => {
  const app = createApp(config, async () => {
    throw new Error('Invalid import payload should fail before any upstream request')
  }, logger)
  const request = (origin: string | undefined, requestedWith = 'XMLHttpRequest') => app.request('/api/fns/import', {
    method: 'POST',
    headers: {
      ...(origin ? { Origin: origin } : {}),
      'X-Requested-With': requestedWith,
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    },
    body: '{}',
  })

  const localAlias = await request('http://localhost:5173')
  assert.equal(localAlias.status, 400)
  assert.deepEqual(await localAlias.json(), {
    error: { code: 'INVALID_IMPORT', message: 'Selecione até 100 registros FNS identificados e informe filtros válidos.' },
  })

  for (const [origin, requestedWith] of [
    ['http://localhost:5174', 'XMLHttpRequest'],
    ['https://localhost:5173', 'XMLHttpRequest'],
    ['https://attacker.example', 'XMLHttpRequest'],
    [undefined, 'XMLHttpRequest'],
    ['http://localhost:5173', ''],
  ] as const) {
    const response = await request(origin, requestedWith)
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), {
      error: { code: 'INVALID_ORIGIN', message: 'A origem da operação não foi validada.' },
    })
  }
})

test('shared-data reads forward the caller JWT and only the public anon key', async () => {
  let url = ''
  let authorization = ''
  let apiKey = ''
  const app = createApp(config, async (input, init) => {
    url = String(input)
    authorization = new Headers(init?.headers).get('authorization') ?? ''
    apiKey = new Headers(init?.headers).get('apikey') ?? ''
    return Response.json([{ id: 'record-1' }])
  }, logger)
  const response = await app.request('/api/data/baixas', {
    headers: { Authorization: 'Bearer user-jwt' },
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), [{ id: 'record-1' }])
  assert.match(url, /^https:\/\/project\.supabase\.co\/rest\/v1\/baixas\?/)
  assert.equal(authorization, 'Bearer user-jwt')
  assert.equal(apiKey, 'public-anon-key')
})

test('protected data routes reject missing JWT without contacting Supabase', async () => {
  let requests = 0
  const app = createApp(config, async () => {
    requests += 1
    return Response.json([])
  }, logger)
  const response = await app.request('/api/data/baixas')

  assert.equal(response.status, 401)
  assert.equal(requests, 0)
})

test('local test mode reads shared records with the server-only service key and returns pagination metadata', async () => {
  const requestedUrls: string[] = []
  let authorization = ''
  let apiKey = ''
  let requestedUrl = ''
  const testConfig: ServerConfig = {
    ...config,
    supabaseTestMode: true,
    supabaseServiceRoleKey: 'server-only-service-role',
  }
  const app = createApp(testConfig, async (input, init) => {
    requestedUrl = String(input)
    requestedUrls.push(requestedUrl)
    authorization = new Headers(init?.headers).get('authorization') ?? ''
    apiKey = new Headers(init?.headers).get('apikey') ?? ''
    return new Response('[]', { headers: { 'Content-Range': '*/0' } })
  }, logger)
  const status = await app.request('/api/storage/status')
  const response = await app.request('/api/data/repasses?page=1&pageSize=25&year=2026&month=9&uf=SP&query=Hospital%20Municipal', {
    headers: { Authorization: 'Bearer' },
  })

  assert.equal(status.status, 200)
  assert.deepEqual(await status.json(), { sharedStorageEnabled: true })
  assert.deepEqual(requestedUrls.slice(0, 6).map((url) => new URL(url).pathname), [
    '/rest/v1/fns_repasses',
    '/rest/v1/fns_importacoes',
    '/rest/v1/fns_financial_launches',
    '/rest/v1/fns_financial_complements',
    '/rest/v1/fns_repasses',
    '/rest/v1/fns_financial_launches',
  ])
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { items: [], total: 0, page: 1, pageSize: 25 })
  assert.match(requestedUrl, /\/rest\/v1\/fns_repasses\?/)
  const query = new URL(requestedUrl).searchParams
  assert.equal(query.get('reference_year'), 'eq.2026')
  assert.equal(query.get('reference_month'), 'eq.9')
  assert.equal(query.get('municipality_uf'), 'eq.SP')
  assert.match(query.get('or') ?? '', /beneficiary_name\.ilike\.\*Hospital\*Municipal\*/)
  assert.equal(authorization, 'Bearer server-only-service-role')
  assert.equal(apiKey, 'server-only-service-role')
})

test('shared-storage status reports a missing database table and logs its endpoint safely', async () => {
  const logs: string[] = []
  const testConfig: ServerConfig = {
    ...config,
    supabaseTestMode: true,
    supabaseServiceRoleKey: 'server-only-service-role',
  }
  const app = createApp(testConfig, async (input) => {
    if (String(input).includes('/fns_financial_launches?')) {
      return Response.json({
        code: 'PGRST205',
        message: "Could not find the table 'public.fns_financial_launches' in the schema cache",
      }, { status: 404 })
    }
    return Response.json([])
  }, { info() {}, error(message) { logs.push(message) } })

  const response = await app.request('/api/storage/status')
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    sharedStorageEnabled: false,
    error: { code: 'SUPABASE_TABLE_UNAVAILABLE' },
  })
  assert.ok(logs.some((message) => message.includes('/rest/v1/fns_financial_launches')
    && message.includes('"errorCode":"PGRST205"')
    && message.includes('"stage":"http_response"')))
  assert.ok(logs.some((message) => message.includes('"stage":"schema_validation"')
    && message.includes('"errorCode":"SUPABASE_TABLE_UNAVAILABLE"')))
  assert.equal(logs.some((message) => message.includes('server-only-service-role')), false)
})

test('shared-storage status distinguishes missing columns, relationships, and permissions', async () => {
  const scenarios = [
    { status: 400, payload: { code: 'PGRST204', message: 'Column missing.' }, expected: 'SUPABASE_COLUMN_UNAVAILABLE' },
    { status: 400, payload: { code: 'PGRST200', message: 'Relationship missing.' }, expected: 'SUPABASE_RELATION_UNAVAILABLE' },
    { status: 403, payload: { code: '42501', message: 'Permission denied.' }, expected: 'SUPABASE_PERMISSION_DENIED' },
  ]
  const testConfig: ServerConfig = {
    ...config,
    supabaseTestMode: true,
    supabaseServiceRoleKey: 'server-only-service-role',
  }
  for (const scenario of scenarios) {
    const app = createApp(testConfig, async () => Response.json(scenario.payload, { status: scenario.status }), logger)
    const response = await app.request('/api/storage/status')
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      sharedStorageEnabled: false,
      error: { code: scenario.expected },
    })
  }
})

test('test mode requires the server key and refuses non-local binding', () => {
  const baseEnvironment = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'public-anon-key',
    SUPABASE_TEST_MODE: 'true',
  }
  assert.throws(() => loadConfig(baseEnvironment), /SUPABASE_SERVICE_ROLE_KEY/)
  assert.throws(() => loadConfig({
    ...baseEnvironment,
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-service-role',
    HOST: '0.0.0.0',
  }), /host local/)
  assert.equal(loadConfig({
    ...baseEnvironment,
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-service-role',
  }).supabaseTestMode, true)
})

test('mutations require same-origin request metadata and discard unapproved columns', async () => {
  let forwarded: Record<string, unknown> | null = null
  const app = createApp(config, async (_input, init) => {
    forwarded = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json([{ id: 'amendment-1' }])
  }, logger)
  const response = await app.request('/api/data/amendments', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer user-jwt',
      Origin: config.frontendOrigin,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uf: 'SP',
      identificacao: 'A-1',
      valor: 100,
      objeto: 'Equipamento',
      created_by: 'attacker-id',
      is_admin: true,
    }),
  })

  assert.equal(response.status, 201)
  assert.deepEqual(forwarded, {
    uf: 'SP',
    identificacao: 'A-1',
    valor: 100,
    objeto: 'Equipamento',
  })
})

test('mutations with an invalid origin are rejected before reaching Supabase', async () => {
  let requests = 0
  const app = createApp(config, async () => {
    requests += 1
    return Response.json([])
  }, logger)
  const response = await app.request('/api/data/amendments', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer user-jwt',
      Origin: 'https://attacker.example',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uf: 'SP' }),
  })

  assert.equal(response.status, 403)
  assert.equal(requests, 0)
})

test('delete mutations confirm a deleted row and return not-found for empty results', async () => {
  let prefer = ''
  const app = createApp(config, async (_input, init) => {
    prefer = new Headers(init?.headers).get('Prefer') ?? ''
    return Response.json([{ id: 'deputy-1' }])
  }, logger)
  const response = await app.request('/api/data/deputies/deputy-1', {
    method: 'DELETE',
    headers: {
      Authorization: 'Bearer test-session',
      Origin: config.frontendOrigin,
      'X-Requested-With': 'XMLHttpRequest',
    },
  })

  assert.equal(response.status, 200)
  assert.equal(prefer, 'return=representation')
  assert.deepEqual(await response.json(), [{ id: 'deputy-1' }])

  const missingApp = createApp(config, async () => Response.json([]), logger)
  const missingResponse = await missingApp.request('/api/data/deputies/missing-id', {
    method: 'DELETE',
    headers: {
      Authorization: 'Bearer test-session',
      Origin: config.frontendOrigin,
      'X-Requested-With': 'XMLHttpRequest',
    },
  })
  assert.equal(missingResponse.status, 404)
  assert.deepEqual(await missingResponse.json(), {
    error: { code: 'DATA_NOT_FOUND', message: 'Nenhum registro correspondente foi alterado no banco de dados.' },
  })
})

test('financial draft reads can filter by exact action key', async () => {
  let requestedUrl = ''
  const app = createApp(config, async (input) => {
    requestedUrl = String(input)
    return Response.json([{ action_key: 'action:2026:entity' }])
  }, logger)
  const response = await app.request('/api/data/launches?key=action%3A2026%3Aentity', {
    headers: { Authorization: 'Bearer test-session' },
  })

  assert.equal(response.status, 200)
  assert.equal(new URL(requestedUrl).searchParams.get('action_key'), 'eq.action:2026:entity')
  assert.equal(new URL(requestedUrl).searchParams.get('limit'), '1')
})

test('financial repasse matching applies all official identifiers on the server', async () => {
  let requestedUrl = ''
  const testConfig: ServerConfig = {
    ...config,
    supabaseTestMode: true,
    supabaseServiceRoleKey: 'server-only-service-role',
  }
  const app = createApp(testConfig, async (input) => {
    requestedUrl = String(input)
    return new Response(JSON.stringify([{ id: 'repasse-1' }]), {
      headers: { 'Content-Range': '0-0/1' },
    })
  }, logger)
  const response = await app.request(
    '/api/data/repasses?match=financialAction&page=1&pageSize=2&matchYear=2026&matchMonth=9&matchQueryType=1&matchUf=SP&matchMunicipalityIbge=3500801&matchBeneficiaryCnpj=12345678000199&matchTransferIdentifier=44',
    { headers: { Authorization: 'Bearer' } },
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    items: [{ id: 'repasse-1' }],
    total: 1,
    page: 1,
    pageSize: 2,
  })
  const query = new URL(requestedUrl).searchParams
  assert.equal(query.get('reference_year'), 'eq.2026')
  assert.equal(query.get('reference_month'), 'eq.9')
  assert.equal(query.get('query_type'), 'eq.1')
  assert.equal(query.get('municipality_uf'), 'eq.SP')
  assert.equal(query.get('municipality_ibge'), 'eq.3500801')
  assert.equal(query.get('beneficiary_cnpj'), 'eq.12345678000199')
  assert.equal(query.get('transfer_identifier'), 'eq.44')
})

test('financial draft mutations accept the repasse link and reject invalid internal fields', async () => {
  const payload = {
    action_key: 'a'.repeat(64),
    repasse_id: '35000000-0000-4000-8000-000000000001',
    status: 'Pendente',
    amount: 125.5,
    launch_date: '2026-09-10',
    document_number: 'DOC-1',
    account_reference: 'Conta municipal',
    responsible: 'Gestor',
    observations: 'Rascunho interno',
  }
  const testConfig: ServerConfig = {
    ...config,
    supabaseTestMode: true,
    supabaseServiceRoleKey: 'server-only-service-role',
  }
  const forwarded: { payload?: Record<string, unknown>; url?: string; prefer?: string | null } = {}
  const app = createApp(testConfig, async (input, init) => {
    forwarded.url = String(input)
    forwarded.payload = JSON.parse(String(init?.body)) as Record<string, unknown>
    forwarded.prefer = new Headers(init?.headers).get('Prefer')
    return Response.json([payload])
  }, logger)
  const headers = {
    Authorization: 'Bearer',
    Origin: config.frontendOrigin,
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json',
  }
  const response = await app.request('/api/data/launches', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  assert.equal(response.status, 201)
  assert.ok(forwarded.payload)
  assert.equal(forwarded.payload.repasse_id, payload.repasse_id)
  assert.ok(forwarded.url?.includes('on_conflict=action_key'))
  assert.equal(forwarded.prefer, 'resolution=merge-duplicates,return=representation')

  let requests = 0
  const invalidApp = createApp(testConfig, async () => {
    requests += 1
    return Response.json([])
  }, logger)
  const invalidResponse = await invalidApp.request('/api/data/launches', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, amount: -1 }),
  })
  assert.equal(invalidResponse.status, 400)
  assert.equal(requests, 0)
  const missingRepasseResponse = await invalidApp.request('/api/data/launches', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, repasse_id: null }),
  })
  assert.equal(missingRepasseResponse.status, 400)
  assert.equal(requests, 0)

  const failedApp = createApp(testConfig, async () => Response.json({
    code: 'XX000',
    message: 'Database write failed',
  }, { status: 500 }), logger)
  const failedResponse = await failedApp.request('/api/data/launches', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  assert.equal(failedResponse.status, 502)
  assert.deepEqual(await failedResponse.json(), {
    error: { code: 'SUPABASE_UNAVAILABLE', message: 'Não foi possível acessar o banco de dados compartilhado.' },
  })
})

test('FNS import accepts the observed zero-based entity page, validates selection, and upserts idempotently', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const app = createApp(config, async (input, init) => {
    const url = String(input)
    requests.push({ url, init })
    if (url.includes('/rest/v1/fns_importacoes') && init?.method === 'POST') {
      return Response.json([{ id: 'import-1' }])
    }
    if (url.includes('/recursos/consulta-detalhada/detalhe-acao')) {
      return Response.json({ resultado: {
        dados: [{ id: 44, descricao: 'Ação oficial', valorTotal: 1250, valorDescontoTotal: 50, valorLiquido: 1200 }],
        pagina: 1, itensPorPagina: 100, total: 1, totalPaginas: 1,
      } })
    }
    if (url.includes('/recursos/consulta-detalhada/entidades')) {
      return Response.json({ resultado: {
        dados: [{ cpfCnpj: '12345678901234', razaoSocial: 'Hospital Municipal', codigoMunicipioIBGE: '350080' }],
        pagina: 0, itensPorPagina: 100, total: 1, totalPaginas: 1,
      } })
    }
    if (url.includes('/rest/v1/fns_repasses') && (!init?.method || init.method === 'GET')) return Response.json([])
    if (url.includes('/rest/v1/fns_repasses') && init?.method === 'POST') {
      return Response.json(JSON.parse(String(init.body)))
    }
    if (url.includes('/rest/v1/fns_importacoes') && init?.method === 'PATCH') {
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }, logger)

  const response = await app.request('/api/fns/import', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer user-jwt',
      Origin: config.frontendOrigin,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filters: {
        ano: '2026',
        mes: '9',
        tipoConsulta: '2',
        estado: 'SP',
        municipio: '3500808',
        cpfCnpjUg: '12.345.678/9012-34',
      },
      selectedIds: ['44'],
    }),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { importId: 'import-1', found: 1, imported: 1, updated: 0, ignored: 0 })
  const fnsRequests = requests.filter((request) => request.url.includes('consultafns.saude.gov.br'))
  assert.equal(fnsRequests.length, 2)
  assert.ok(fnsRequests.every((request) => request.url.startsWith('https://consultafns.saude.gov.br/recursos/')))
  const upsert = requests.find((request) => request.url.includes('/rest/v1/fns_repasses') && request.init?.method === 'POST')
  assert.ok(upsert)
  const savedRecords = JSON.parse(String(upsert.init?.body)) as Record<string, unknown>[]
  assert.equal(savedRecords[0].transfer_identifier, '44')
  assert.equal(savedRecords[0].beneficiary_name, 'Hospital Municipal')
  assert.equal(savedRecords[0].net_amount, 1200)
  assert.equal(savedRecords[0].source_endpoint, 'https://consultafns.saude.gov.br/recursos/consulta-detalhada/detalhe-acao')
  const importUpdate = requests.find((request) => request.url.includes('/rest/v1/fns_importacoes') && request.init?.method === 'PATCH')
  assert.ok(importUpdate)
  assert.match(String(importUpdate.init?.body), /"status":"concluida"/)
})

test('local test mode imports explicitly selected official FNS records without a caller JWT', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const testConfig: ServerConfig = {
    ...config,
    supabaseTestMode: true,
    supabaseServiceRoleKey: 'server-only-service-role',
  }
  const app = createApp(testConfig, async (input, init) => {
    const url = String(input)
    requests.push({ url, init })
    if (url.includes('/rest/v1/fns_importacoes') && init?.method === 'POST') {
      return Response.json([{ id: 'local-import-1' }])
    }
    if (url.includes('/recursos/consulta-detalhada/detalhe-acao')) {
      return Response.json({ resultado: {
        dados: [{ id: 45, descricao: 'Ação oficial selecionada', valorTotal: 500, valorLiquido: 500 }],
        pagina: 1, itensPorPagina: 100, total: 1, totalPaginas: 1,
      } })
    }
    if (url.includes('/recursos/consulta-detalhada/entidades')) {
      return Response.json({ resultado: {
        dados: [{ cpfCnpj: '12345678901234', razaoSocial: 'Hospital Municipal', codigoMunicipioIBGE: '350080' }],
        pagina: 1, itensPorPagina: 100, total: 1, totalPaginas: 1,
      } })
    }
    if (url.includes('/rest/v1/fns_repasses') && (!init?.method || init.method === 'GET')) return Response.json([])
    if (url.includes('/rest/v1/fns_repasses') && init?.method === 'POST') {
      return Response.json(JSON.parse(String(init.body)))
    }
    if (url.includes('/rest/v1/fns_importacoes') && init?.method === 'PATCH') {
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }, logger)
  const response = await app.request('/api/fns/import', {
    method: 'POST',
    headers: {
      Origin: config.frontendOrigin,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filters: {
        ano: '2026',
        mes: '9',
        tipoConsulta: '2',
        estado: 'SP',
        municipio: '3500808',
        cpfCnpjUg: '12345678901234',
      },
      selectedIds: ['45'],
    }),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { importId: 'local-import-1', found: 1, imported: 1, updated: 0, ignored: 0 })
  const supabaseRequests = requests.filter((request) => request.url.includes('/rest/v1/'))
  assert.ok(supabaseRequests.length > 0)
  assert.ok(supabaseRequests.every((request) =>
    new Headers(request.init?.headers).get('authorization') === 'Bearer server-only-service-role'
    && new Headers(request.init?.headers).get('apikey') === 'server-only-service-role',
  ))
})

test('repeating the same FNS import updates the unique row instead of duplicating it', async () => {
  const saved = new Map<string, Record<string, unknown>>()
  let importNumber = 0
  const testConfig: ServerConfig = {
    ...config,
    supabaseTestMode: true,
    supabaseServiceRoleKey: 'server-only-service-role',
  }
  const app = createApp(testConfig, async (input, init) => {
    const url = String(input)
    if (url.includes('/rest/v1/fns_importacoes') && init?.method === 'POST') {
      importNumber += 1
      return Response.json([{ id: `repeat-import-${importNumber}` }])
    }
    if (url.includes('/recursos/consulta-detalhada/detalhe-acao')) {
      return Response.json({ resultado: {
        dados: [{ id: 46, descricao: 'Ação oficial', valorTotal: 750, valorLiquido: 750 }],
        pagina: 1, itensPorPagina: 100, total: 1, totalPaginas: 1,
      } })
    }
    if (url.includes('/recursos/consulta-detalhada/entidades')) {
      return Response.json({ resultado: {
        dados: [{ cpfCnpj: '12345678901234', razaoSocial: 'Hospital Municipal', codigoMunicipioIBGE: '350080' }],
        pagina: 1, itensPorPagina: 100, total: 1, totalPaginas: 1,
      } })
    }
    if (url.includes('/rest/v1/fns_repasses') && (!init?.method || init.method === 'GET')) {
      return Response.json([...saved.keys()].map((source_key) => ({ source_key })))
    }
    if (url.includes('/rest/v1/fns_repasses') && init?.method === 'POST') {
      const records = JSON.parse(String(init.body)) as Record<string, unknown>[]
      for (const record of records) saved.set(String(record.source_key), record)
      return Response.json(records)
    }
    if (url.includes('/rest/v1/fns_importacoes') && init?.method === 'PATCH') {
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }, logger)
  const importRequest = () => app.request('/api/fns/import', {
    method: 'POST',
    headers: {
      Origin: config.frontendOrigin,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filters: { ano: '2026', mes: '9', tipoConsulta: '2', estado: 'SP', municipio: '3500808', cpfCnpjUg: '12345678901234' },
      selectedIds: ['46'],
    }),
  })

  const first = await importRequest()
  const firstResult = await first.json()
  const second = await importRequest()
  const secondResult = await second.json()
  assert.deepEqual(firstResult, { importId: 'repeat-import-1', found: 1, imported: 1, updated: 0, ignored: 0 })
  assert.deepEqual(secondResult, { importId: 'repeat-import-2', found: 1, imported: 0, updated: 1, ignored: 0 })
  assert.equal(saved.size, 1)
})

test('an FNS failure marks the import failed and never upserts repasses', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const app = createApp(config, async (input, init) => {
    const url = String(input)
    requests.push({ url, init })
    if (url.includes('/rest/v1/fns_importacoes') && init?.method === 'POST') return Response.json([{ id: 'import-failed' }])
    if (url.includes('/recursos/consulta-detalhada/detalhe-acao')) return new Response('unavailable', { status: 503 })
    if (url.includes('/rest/v1/fns_importacoes') && init?.method === 'PATCH') return new Response(null, { status: 204 })
    throw new Error(`Unexpected request: ${url}`)
  }, logger)
  const response = await app.request('/api/fns/import', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer user-jwt',
      Origin: config.frontendOrigin,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filters: { ano: '2026', estado: 'SP', municipio: '3500808', cpfCnpjUg: '12345678901234' },
      selectedIds: ['44'],
    }),
  })

  assert.equal(response.status, 502)
  assert.equal(requests.some((request) => request.url.includes('/rest/v1/fns_repasses')), false)
  const failedImport = requests.find((request) => request.url.includes('/rest/v1/fns_importacoes') && request.init?.method === 'PATCH')
  assert.ok(failedImport)
  assert.match(String(failedImport.init?.body), /"status":"falhou"/)
})
