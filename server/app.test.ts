import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp, fnsMunicipalityCode } from './app.js'
import type { ServerConfig } from './config.js'
import { DEFAULT_CONSULTATION_TYPE, getDefaultConsultationType } from '../src/utils/consultationTypes.js'
import { findMunicipalityByName, getConsultationMunicipalityCode, searchMunicipalities } from '../src/utils/municipalitySearch.js'
import { getActivePartnerMunicipalities, partnerMunicipalities, partnerStates } from '../src/data/partnerMunicipalities.js'

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 3001,
  frontendOrigin: 'http://127.0.0.1:5173',
  fnsTimeoutMs: 1000,
}

const silentLogger = { info() {}, error() {} }

test('proxy forwards only the five typed FNS resources and preserves their envelopes', async () => {
  const resources = [
    ['/api/fns/anos', '/anos', { resultado: [{ valor: '2026', descricao: '2026' }] }],
    ['/api/fns/tipos-consulta/2026', '/tipos-consulta/2026', { resultado: [{ valor: 2, descricao: 'Fundo a Fundo' }] }],
    ['/api/fns/repasses', '/repasses', { resultado: [{ valor: 1, descricao: 'Ação Judicial' }] }],
    ['/api/fns/ufs', '/ufs', { resultado: [{ coUfIbge: '12', sigla: 'AC', nome: 'ACRE', registroAtivo: 'S', id: '12' }] }],
    ['/api/fns/meses', '/meses', { resultado: [{ descricao: 'Março', valor: 3 }] }],
  ] as const

  for (const [route, upstreamPath, payload] of resources) {
    let requestedUrl = ''
    const app = createApp(config, async (input) => {
      requestedUrl = String(input)
      return Response.json(payload)
    }, silentLogger)
    const response = await app.request(route)
    assert.equal(response.status, 200)
    assert.equal(requestedUrl, `https://consultafns.saude.gov.br/recursos${upstreamPath}`)
    assert.deepEqual(await response.json(), payload)
  }
})

test('validates year and never forwards an arbitrary path', async () => {
  let requests = 0
  const app = createApp(config, async () => {
    requests += 1
    return Response.json({ resultado: [] })
  }, silentLogger)

  const invalidYear = await app.request('/api/fns/tipos-consulta/20xx')
  assert.equal(invalidYear.status, 400)
  assert.deepEqual(await invalidYear.json(), { error: { code: 'INVALID_YEAR', message: 'O ano deve conter quatro dígitos.', retryable: false } })

  const unknownRoute = await app.request('/api/fns/https://example.com')
  assert.equal(unknownRoute.status, 404)
  assert.equal(requests, 0)
})

test('restricts CORS to the configured frontend origin', async () => {
  const app = createApp(config, async () => Response.json({ resultado: [] }), silentLogger)
  const allowed = await app.request('/api/fns/anos', { headers: { Origin: config.frontendOrigin } })
  const denied = await app.request('/api/fns/anos', { headers: { Origin: 'https://example.com' } })
  assert.equal(allowed.headers.get('access-control-allow-origin'), config.frontendOrigin)
  assert.equal(denied.headers.get('access-control-allow-origin'), null)
})

test('returns a sanitized timeout error when the FNS request times out', async () => {
  const timeout = Object.assign(new Error('request canceled'), { name: 'TimeoutError' })
  let requests = 0
  const logs: string[] = []
  const app = createApp(config, async () => {
    requests += 1
    throw timeout
  }, { info() {}, error(message) { logs.push(message) } })
  const response = await app.request('/api/fns/anos')
  assert.equal(response.status, 504)
  assert.deepEqual(await response.json(), { error: { code: 'FNS_TIMEOUT', message: 'O portal FNS não respondeu dentro do prazo.', retryable: true } })
  assert.equal(requests, 2)
  assert.equal(logs.some((log) => log.includes('"timeoutMs":1000')), true)
})

test('rejects malformed upstream JSON with the standard error envelope', async () => {
  const app = createApp(config, async () => new Response('{', {
    headers: { 'content-type': 'application/json' },
  }), silentLogger)
  const response = await app.request('/api/fns/anos')
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: { code: 'FNS_INVALID_RESPONSE', message: 'O portal FNS retornou um JSON inválido.', retryable: false } })
})

test('rejects a valid JSON response with an invalid resource shape', async () => {
  const app = createApp(config, async () => Response.json({ resultado: [{ valor: 2026 }] }), silentLogger)
  const response = await app.request('/api/fns/anos')
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: { code: 'FNS_INVALID_RESPONSE', message: 'O portal FNS retornou dados em formato inesperado.', retryable: false } })
})

test('preserves upstream 503, retries once, and logs sanitized URL and response body', async () => {
  let requests = 0
  const logs: string[] = []
  const app = createApp(config, async () => {
    requests += 1
    return new Response('{"message":"maintenance","token":"sensitive-value"}', {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })
  }, { info() {}, error(message) { logs.push(message) } })
  const response = await app.request('/api/fns/anos')
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    error: { code: 'FNS_UNAVAILABLE', message: 'O portal FNS está temporariamente indisponível (HTTP 503).', retryable: true },
  })
  assert.equal(requests, 2)
  assert.equal(logs.some((log) => log.includes('"url":"https://consultafns.saude.gov.br/recursos/anos"')), true)
  assert.equal(logs.some((log) => log.includes('"bodyPreview":"{\\"message\\":\\"maintenance\\",\\"token\\":\\"[REDACTED]\\"}"')), true)
  assert.equal(logs.some((log) => log.includes('sensitive-value')), false)
})

test('preserves upstream 502 and retries the transient request once', async () => {
  let requests = 0
  const app = createApp(config, async () => {
    requests += 1
    return new Response('bad gateway', { status: 502 })
  }, silentLogger)
  const response = await app.request('/api/fns/anos')
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), {
    error: { code: 'FNS_UNAVAILABLE', message: 'O portal FNS está temporariamente indisponível (HTTP 502).', retryable: true },
  })
  assert.equal(requests, 2)
})

test('does not retry non-transient upstream errors', async () => {
  let requests = 0
  const app = createApp(config, async () => {
    requests += 1
    return new Response('not found', { status: 404 })
  }, silentLogger)
  const response = await app.request('/api/fns/anos')
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    error: { code: 'FNS_UNAVAILABLE', message: 'O portal FNS respondeu com HTTP 404.', retryable: false },
  })
  assert.equal(requests, 1)
})

test('returns only active partner municipalities, grouped by UF, without upstream calls', async () => {
  let requests = 0
  const app = createApp(config, async () => {
    requests += 1
    return Response.json({})
  }, silentLogger)
  const allResponse = await app.request('/api/fns/municipios')
  const spResponse = await app.request('/api/fns/municipios/SP')
  const mgResponse = await app.request('/api/fns/municipios/MG')
  const rsResponse = await app.request('/api/fns/municipios/RS')
  const all = (await allResponse.json() as { resultado: { sgUf: string; id: string }[] }).resultado
  assert.equal(allResponse.status, 200)
  assert.equal(all.length, 31)
  assert.equal(partnerMunicipalities.length, 31)
  assert.equal(partnerMunicipalities.every((municipality) => municipality.active), true)
  assert.deepEqual([...new Set(all.map((item) => item.sgUf))].sort(), ['MG', 'RS', 'SP'])
  assert.equal((await spResponse.json() as { resultado: unknown[] }).resultado.length, 21)
  assert.equal((await mgResponse.json() as { resultado: unknown[] }).resultado.length, 9)
  assert.equal((await rsResponse.json() as { resultado: unknown[] }).resultado.length, 1)
  assert.deepEqual(partnerStates.map((item) => item.uf), ['MG', 'RS', 'SP'])
  assert.equal(requests, 0)
})

test('rejects a UF without active partner municipalities', async () => {
  let requests = 0
  const app = createApp(config, async () => {
    requests += 1
    return Response.json({ resultado: [] })
  }, silentLogger)
  const response = await app.request('/api/fns/municipios/XX')
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    error: { code: 'INVALID_UF', message: 'Informe uma UF com municípios parceiros ativos.', retryable: false },
  })
  assert.equal(requests, 0)
})

test('maps all 31 full IBGE codes to the six-digit FNS municipality codes', () => {
  assert.equal(partnerMunicipalities.length, 31)
  assert.equal(new Set(partnerMunicipalities.map((municipality) => municipality.ibgeCode)).size, 31)
  assert.equal(partnerMunicipalities.every((municipality) => /^\d{7}$/.test(municipality.ibgeCode)), true)
  assert.equal(partnerMunicipalities.every((municipality) => municipality.active), true)
  assert.equal(getActivePartnerMunicipalities().length, 31)
  assert.deepEqual(
    partnerMunicipalities.map((municipality) => fnsMunicipalityCode(municipality.ibgeCode)),
    partnerMunicipalities.map((municipality) => municipality.ibgeCode.slice(0, 6)),
  )
  assert.equal(fnsMunicipalityCode('3500808'), '350080')
  assert.deepEqual(partnerStates.map(({ uf }) => uf), ['MG', 'RS', 'SP'])
})

test('loads and caches blocks by year and consultation type', async () => {
  let requestCount = 0
  const app = createApp(config, async (input) => {
    requestCount += 1
    assert.equal(String(input), 'https://consultafns.saude.gov.br/recursos/blocos?ano=2026&coTipoConsulta=2')
    return Response.json({ resultado: [{ id: '11', nome: 'Estruturação da Rede de Serviços Públicos de Saúde' }] })
  }, silentLogger)

  const first = await app.request('/api/fns/blocos?ano=2026&coTipoConsulta=2')
  const second = await app.request('/api/fns/blocos?ano=2026&coTipoConsulta=2')
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(requestCount, 1)
})

test('validates block parameters without making an upstream request', async () => {
  let requests = 0
  const app = createApp(config, async () => {
    requests += 1
    return Response.json({ resultado: [] })
  }, silentLogger)
  const invalidYear = await app.request('/api/fns/blocos?ano=26&coTipoConsulta=2')
  const invalidType = await app.request('/api/fns/blocos?ano=2026&coTipoConsulta=abc')
  assert.equal(invalidYear.status, 400)
  assert.equal(invalidType.status, 400)
  assert.equal(requests, 0)
})

test('maps the official consultation response and forwards selected filters and pagination', async () => {
  let requestedUrl = ''
  const payload = {
    dados: [{
      uf: 'SP',
      municipio: 'ALFREDO MARCONDES',
      cpfCnpj: '12345678000199',
      razaoSocial: 'Fundo Municipal de Saúde',
      codigoMunicipioIBGE: '350080',
      esferaAdministrativa: 'Municipal',
      entidadeSemRepasse: false,
      cpfCnpjFormatado: '12.345.678/0001-99',
      federal: true,
      esferaEstadual: false,
      tipoDirigente: 'Gestor',
    }],
    pagina: 1,
    itensPorPagina: 8,
    total: 17,
    totalPaginas: 3,
  }
  const app = createApp(config, async (input) => {
    requestedUrl = String(input)
    return Response.json(payload)
  }, silentLogger)
  const response = await app.request('/api/fns/consultas?ano=2026&mes=10&tipoConsulta=2&estado=SP&municipio=3500808&page=2&count=8&blocos=11&grupo=Municipal&cpfCnpjUg=123&processo=456&proposta=789&repasse=1&dataInicialOb=2026-01-01&dataFinalOb=2026-10-20&portaria=101')

  assert.equal(response.status, 200)
  const parsedUrl = new URL(requestedUrl)
  assert.equal(parsedUrl.origin + parsedUrl.pathname, 'https://consultafns.saude.gov.br/recursos/consulta-detalhada/entidades')
  assert.deepEqual(Object.fromEntries(parsedUrl.searchParams), {
    ano: '2026',
    mes: '10',
    tipoConsulta: '2',
    estado: 'SP',
    municipio: '350080',
    blocos: '11',
    grupo: 'Municipal',
    cpfCnpjUg: '123',
    processo: '456',
    proposta: '789',
    repasse: '1',
    dataInicialOb: '2026-01-01',
    dataFinalOb: '2026-10-20',
    portaria: '101',
    page: '2',
    count: '8',
  })
  assert.deepEqual(await response.json(), payload)
})

test('normalizes the observed FNS resultado wrapper to the consultation response contract', async () => {
  const payload = {
    resultado: {
      dados: [{ uf: 'SP', municipio: 'ALFREDO MARCONDES', razaoSocial: 'Fundo Municipal de Saúde' }],
      pagina: 0,
      itensPorPagina: 8,
      total: 1,
      totalPaginas: 1,
    },
  }
  const app = createApp(config, async () => Response.json(payload), silentLogger)
  const response = await app.request('/api/fns/consultas?ano=2026&mes=10&tipoConsulta=2&estado=SP&municipio=3500808&page=1&count=8')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), payload.resultado)
})

test('requires an authorized partner municipality before calling the FNS', async () => {
  let requests = 0
  const app = createApp(config, async () => {
    requests += 1
    return Response.json({ dados: [], pagina: 0, itensPorPagina: 8, total: 0, totalPaginas: 0 })
  }, silentLogger)
  const missing = await app.request('/api/fns/consultas')
  const unauthorized = await app.request('/api/fns/consultas?estado=SP&municipio=3500602')
  const unknown = await app.request('/api/fns/consultas?estado=MG&municipio=9999999')
  const wrongUf = await app.request('/api/fns/consultas?estado=MG&municipio=3500808')
  const malformed = await app.request('/api/fns/consultas?estado=SP&municipio=350080')
  assert.equal(missing.status, 400)
  assert.equal(unauthorized.status, 403)
  assert.equal(unknown.status, 403)
  assert.equal(wrongUf.status, 403)
  assert.equal(malformed.status, 400)
  assert.equal(requests, 0)
})

test('omits blank optional consultation parameters and forwards an active municipality', async () => {
  let requestedUrl = ''
  const app = createApp(config, async (input) => {
    requestedUrl = String(input)
    return Response.json({ dados: [], pagina: 0, itensPorPagina: 8, total: 0, totalPaginas: 0 })
  }, silentLogger)
  const response = await app.request('/api/fns/consultas?ano=&mes=&tipoConsulta=&estado=SP&municipio=3500808&grupo=&page=1&count=8')
  assert.equal(response.status, 200)
  assert.deepEqual(Object.fromEntries(new URL(requestedUrl).searchParams), {
    estado: 'SP',
    municipio: '350080',
    page: '1',
    count: '8',
  })
})

test('rejects consultation payloads without dados or valid pagination metadata', async () => {
  for (const payload of [
    { resultado: { dados: [] }, pagina: 0, itensPorPagina: 8, total: 0, totalPaginas: 0 },
    { dados: [], pagina: -1, itensPorPagina: 8, total: 0, totalPaginas: 0 },
  ]) {
    const app = createApp(config, async () => Response.json(payload), silentLogger)
    const response = await app.request('/api/fns/consultas?estado=SP&municipio=3500808')
    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), {
      error: {
        code: 'FNS_INVALID_RESPONSE',
        message: 'O portal FNS retornou uma resposta de consulta em formato inesperado.',
        retryable: false,
      },
    })
  }
})

test('preserves consultation upstream HTTP 503 and malformed JSON as errors', async () => {
  const unavailable = createApp(config, async () => new Response('temporarily unavailable', { status: 503 }), silentLogger)
  const unavailableResponse = await unavailable.request('/api/fns/consultas?estado=SP&municipio=3500808')
  assert.equal(unavailableResponse.status, 503)
  assert.deepEqual(await unavailableResponse.json(), {
    error: {
      code: 'FNS_UNAVAILABLE',
      message: 'O portal FNS está temporariamente indisponível (HTTP 503).',
      retryable: true,
    },
  })

  const badGateway = createApp(config, async () => new Response('bad gateway', { status: 502 }), silentLogger)
  const badGatewayResponse = await badGateway.request('/api/fns/consultas?estado=SP&municipio=3500808')
  assert.equal(badGatewayResponse.status, 502)
  assert.deepEqual(await badGatewayResponse.json(), {
    error: {
      code: 'FNS_UNAVAILABLE',
      message: 'O portal FNS está temporariamente indisponível (HTTP 502).',
      retryable: true,
    },
  })

  const timeout = Object.assign(new Error('upstream timeout'), { name: 'TimeoutError' })
  const timedOut = createApp(config, async () => { throw timeout }, silentLogger)
  const timeoutResponse = await timedOut.request('/api/fns/consultas?estado=SP&municipio=3500808')
  assert.equal(timeoutResponse.status, 504)
  assert.deepEqual(await timeoutResponse.json(), {
    error: {
      code: 'FNS_TIMEOUT',
      message: 'O portal FNS não respondeu dentro do prazo.',
      retryable: true,
    },
  })

  const invalidJson = createApp(config, async () => new Response('{', { headers: { 'content-type': 'application/json' } }), silentLogger)
  const invalidJsonResponse = await invalidJson.request('/api/fns/consultas?estado=SP&municipio=3500808')
  assert.equal(invalidJsonResponse.status, 502)
  assert.deepEqual(await invalidJsonResponse.json(), {
    error: {
      code: 'FNS_INVALID_RESPONSE',
      message: 'O portal FNS retornou um JSON inválido.',
      retryable: false,
    },
  })
})

test('forwards entity financial detail filters, selected CNPJ, and FNS page numbering', async () => {
  let requestedUrl = ''
  const financialResponse = {
    resultado: {
      dados: [{
        id: 61659,
        descricao: 'ATENÇÃO À SAÚDE',
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
      }],
      pagina: 2,
      itensPorPagina: 10,
      total: 17,
      totalPaginas: 2,
    },
  }
  const app = createApp(config, async (input) => {
    requestedUrl = String(input)
    return Response.json(financialResponse)
  }, silentLogger)
  const response = await app.request('/api/fns/detalhe-acao?ano=2026&count=10&cpfCnpjUg=15414921000178&estado=SP&mes=9&municipio=3500808&page=2&tipoConsulta=2')
  const url = new URL(requestedUrl)
  assert.equal(response.status, 200)
  assert.equal(url.pathname, '/recursos/consulta-detalhada/detalhe-acao')
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    ano: '2026',
    count: '10',
    cpfCnpjUg: '15414921000178',
    estado: 'SP',
    mes: '9',
    municipio: '350080',
    page: '2',
    tipoConsulta: '2',
  })
  assert.deepEqual(await response.json(), financialResponse.resultado)
})

test('rejects financial detail without an entity document before calling FNS', async () => {
  let requests = 0
  const app = createApp(config, async () => {
    requests += 1
    return Response.json({})
  }, silentLogger)
  const response = await app.request('/api/fns/detalhe-acao?ano=2026&page=1&count=10')
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    error: {
      code: 'INVALID_DOCUMENT',
      message: 'Informe o CPF/CNPJ da entidade para consultar os dados financeiros.',
      retryable: false,
    },
  })
  assert.equal(requests, 0)
})

test('preserves financial detail HTTP 502/503, timeout, and malformed financial JSON errors', async () => {
  const badGateway = createApp(config, async () => new Response('bad gateway', { status: 502 }), silentLogger)
  const badGatewayResponse = await badGateway.request('/api/fns/detalhe-acao?cpfCnpjUg=123&estado=SP&municipio=3500808')
  assert.equal(badGatewayResponse.status, 502)

  const unavailable = createApp(config, async () => new Response('temporarily unavailable', { status: 503 }), silentLogger)
  const unavailableResponse = await unavailable.request('/api/fns/detalhe-acao?cpfCnpjUg=123&estado=SP&municipio=3500808')
  assert.equal(unavailableResponse.status, 503)

  const timeout = Object.assign(new Error('upstream timeout'), { name: 'TimeoutError' })
  const timedOut = createApp(config, async () => { throw timeout }, silentLogger)
  const timeoutResponse = await timedOut.request('/api/fns/detalhe-acao?cpfCnpjUg=123&estado=SP&municipio=3500808')
  assert.equal(timeoutResponse.status, 504)

  const invalid = createApp(config, async () => Response.json({ resultado: { dados: [], pagina: 1, itensPorPagina: 10, total: 0 } }), silentLogger)
  const invalidResponse = await invalid.request('/api/fns/detalhe-acao?cpfCnpjUg=123&estado=SP&municipio=3500808')
  assert.equal(invalidResponse.status, 502)
  assert.deepEqual(await invalidResponse.json(), {
    error: {
      code: 'FNS_INVALID_RESPONSE',
      message: 'O portal FNS retornou dados financeiros em formato inesperado.',
      retryable: false,
    },
  })

})

test('rejects an unknown financial municipality before calling the FNS', async () => {
  let requests = 0
  const app = createApp(config, async () => {
    requests += 1
    return Response.json({ dados: [], pagina: 1, itensPorPagina: 10, total: 0, totalPaginas: 0 })
  }, silentLogger)
  const response = await app.request('/api/fns/detalhe-acao?cpfCnpjUg=123&estado=SP&municipio=9999999')
  assert.equal(response.status, 403)
  assert.equal(requests, 0)
})

test('proxies municipal leadership by the selected IBGE code and caches the official response', async () => {
  for (const [ibgeCode, uf, fnsCode] of [
    ['3500808', 'SP', '350080'],
    ['3101201', 'MG', '310120'],
    ['4316956', 'RS', '431695'],
  ]) {
    let requestedUrl = ''
    let requests = 0
    const leadership = {
      nome: `Prefeito de ${uf}`,
      cargo: 'Prefeito(a)',
      inicioMandato: 1609470000000,
      inicioMandatoFormatado: '01/01/2021',
      noSecretario: 'Secretário oficial',
      noPresidenteConselho: 'Presidente oficial',
    }
    const app = createApp(config, async (input) => {
      requestedUrl = String(input)
      requests += 1
      return Response.json({ resultado: leadership })
    }, silentLogger)
    const first = await app.request(`/api/fns/dirigente/${ibgeCode}`)
    const second = await app.request(`/api/fns/dirigente/${ibgeCode}`)
    assert.equal(first.status, 200)
    assert.equal(requestedUrl, `https://consultafns.saude.gov.br/recursos/dirigente/MUNICIPAL/${fnsCode}`)
    assert.deepEqual(await first.json(), { resultado: leadership })
    assert.deepEqual(await second.json(), { resultado: leadership })
    assert.equal(requests, 1)
  }
})

test('returns no leadership data for empty results and preserves incomplete official fields', async () => {
  const empty = createApp(config, async () => Response.json({ resultado: {} }), silentLogger)
  const emptyResponse = await empty.request('/api/fns/dirigente/3500808')
  assert.equal(emptyResponse.status, 200)
  assert.deepEqual(await emptyResponse.json(), { resultado: null })

  const incomplete = createApp(config, async () => Response.json({ resultado: { nome: 'Prefeita oficial' } }), silentLogger)
  const incompleteResponse = await incomplete.request('/api/fns/dirigente/3500808')
  assert.equal(incompleteResponse.status, 200)
  assert.deepEqual(await incompleteResponse.json(), { resultado: { nome: 'Prefeita oficial' } })
})

test('rejects unregistered leadership codes and invalid upstream leadership data', async () => {
  let requests = 0
  const app = createApp(config, async () => {
    requests += 1
    return Response.json({ resultado: { nome: 10 } })
  }, silentLogger)
  const unauthorized = await app.request('/api/fns/dirigente/3500800')
  const invalidData = await app.request('/api/fns/dirigente/3500808')
  assert.equal(unauthorized.status, 403)
  assert.equal(invalidData.status, 502)
  assert.equal(requests, 1)
})

test('returns transient errors for unavailable municipal leadership endpoints', async () => {
  const unavailable = createApp(config, async () => new Response('temporarily unavailable', { status: 503 }), silentLogger)
  const response = await unavailable.request('/api/fns/dirigente/3500808')
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    error: {
      code: 'FNS_UNAVAILABLE',
      message: 'O portal FNS está temporariamente indisponível (HTTP 503).',
      retryable: true,
    },
  })
})

test('defaults consultation type to Fundo a Fundo value 2 only when available', () => {
  assert.equal(DEFAULT_CONSULTATION_TYPE, '2')
  assert.equal(getDefaultConsultationType([{ valor: 2, descricao: 'Fundo a Fundo' }, { valor: 1, descricao: 'Outra opção' }]), '2')
  assert.equal(getDefaultConsultationType([{ valor: 1, descricao: 'Outra opção' }]), '')
})

test('searches and selects Alfredo Marcondes by normalized name, UF, and IBGE code', () => {
  const municipalities = [
    { coMunicipioIbge: '3500808', noMunicipio: 'Alfredo Marcondes', sgUf: 'SP', id: '3500808' },
    { coMunicipioIbge: '1200013', noMunicipio: 'Alfredo Marcondes', sgUf: 'AC', id: '1200013' },
    { coMunicipioIbge: '3500602', noMunicipio: 'Águas de São Pedro', sgUf: 'SP', id: '3500602' },
  ]

  const matches = searchMunicipalities(municipalities, 'SP', 'alfredo mar')
  const selected = findMunicipalityByName(municipalities, 'SP', 'ALFREDO MARCONDES')
  const accentInsensitiveMatches = searchMunicipalities(municipalities, 'SP', 'aguas de sao')
  assert.equal(matches.length, 1)
  assert.equal(selected?.id, '3500808')
  assert.equal(accentInsensitiveMatches[0].id, '3500602')
  assert.equal(selected ? getConsultationMunicipalityCode(selected) : '', '3500808')
})