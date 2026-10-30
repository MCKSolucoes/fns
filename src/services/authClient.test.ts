import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeUsuario, decodeJwtExp, loadAuthConfig, DEFAULT_SUPABASE_URL, DEFAULT_TURNSTILE_SITE_KEY } from './authClient.js'

test('normalizeUsuario remove pontos e tracos e adiciona dominio', () => {
  assert.equal(normalizeUsuario('123.456.789-00'), '12345678900@sistema.mck')
  assert.equal(normalizeUsuario('  joao.silva  '), 'joaosilva@sistema.mck')
  assert.equal(normalizeUsuario('gestor'), 'gestor@sistema.mck')
  assert.equal(normalizeUsuario('tulio@sistema.mck'), 'tulio@sistema.mck')
  assert.equal(normalizeUsuario(''), '')
})

test('decodeJwtExp extrai exp de payload JWT', () => {
  const exp = 1793200000
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: 'user-id', exp })).toString('base64url')
  const token = `${header}.${payload}.signature`

  assert.equal(decodeJwtExp(token), exp)
})

test('decodeJwtExp retorna null para token malformado ou sem exp', () => {
  assert.equal(decodeJwtExp('invalido'), null)
  assert.equal(decodeJwtExp('a.b'), null)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
  const payloadNoExp = Buffer.from(JSON.stringify({ sub: 'user-id' })).toString('base64url')
  assert.equal(decodeJwtExp(`${header}.${payloadNoExp}.sig`), null)
})

test('loadAuthConfig retorna fallback configurado com URL e Turnstile quando backend offline', async () => {
  const cfg = await loadAuthConfig()
  assert.equal(cfg.authRequired, true)
  assert.equal(cfg.supabaseUrl, DEFAULT_SUPABASE_URL)
  assert.equal(cfg.turnstileSiteKey, DEFAULT_TURNSTILE_SITE_KEY)
})
