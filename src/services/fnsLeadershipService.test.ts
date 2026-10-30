import assert from 'node:assert/strict'
import test from 'node:test'
import { getFnsMunicipalLeadership } from './fnsLeadershipService.js'

test('requests leadership through the backend using the selected full IBGE code', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl = ''
  globalThis.fetch = async (input) => {
    requestedUrl = String(input)
    return Response.json({ resultado: { nome: 'Prefeito oficial', inicioMandato: 1609470000000 } })
  }
  try {
    const result = await getFnsMunicipalLeadership('3101201')
    assert.deepEqual(result, { resultado: { nome: 'Prefeito oficial', inicioMandato: 1609470000000 } })
    assert.equal(requestedUrl, '/api/fns/dirigente/3101201')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('treats empty leadership and missing optional fields as valid responses', async () => {
  const originalFetch = globalThis.fetch
  const responses = [Response.json({ resultado: null }), Response.json({ resultado: {} }), Response.json({ resultado: { nome: 'Gestor oficial' } })]
  globalThis.fetch = async () => responses.shift() ?? Response.json({})
  try {
    assert.deepEqual(await getFnsMunicipalLeadership('3500808'), { resultado: null })
    assert.deepEqual(await getFnsMunicipalLeadership('3500808'), { resultado: null })
    assert.deepEqual(await getFnsMunicipalLeadership('3500808'), { resultado: { nome: 'Gestor oficial' } })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('reports HTTP errors with their retryability and rejects malformed responses', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: 'O portal FNS está temporariamente indisponível (HTTP 503).', retryable: true },
  }), { status: 503, headers: { 'content-type': 'application/json' } })
  try {
    await assert.rejects(getFnsMunicipalLeadership('3500808'), (error: unknown) =>
      error instanceof Error
      && error.message.includes('HTTP 503')
      && 'retryable' in error
      && error.retryable === true,
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  globalThis.fetch = async () => Response.json({ resultado: { nome: 123 } })
  try {
    await assert.rejects(getFnsMunicipalLeadership('3500808'), /formato inesperado/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects invalid IBGE codes without a network request', async () => {
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return Response.json({})
  }
  try {
    await assert.rejects(getFnsMunicipalLeadership('350080'), /código IBGE válido/)
    assert.equal(requests, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
