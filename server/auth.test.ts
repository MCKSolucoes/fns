import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from './app.js'
import type { ServerConfig } from './config.js'

const silentLogger = { info() {}, error() {} }

const baseConfig: ServerConfig = {
  host: '127.0.0.1',
  port: 3001,
  frontendOrigin: 'http://127.0.0.1:5173',
  fnsTimeoutMs: 1000,
  supabaseUrl: 'https://test-project.supabase.co',
  supabaseAnonKey: 'anon-public-key',
  supabaseServiceRoleKey: 'secret-service-role-key',
  authRequired: true,
  turnstileSiteKey: 'test-turnstile-site-key',
}

function makeJwt(userId: string, expSecondsFromNow = 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
  ).toString('base64url')
  return `${header}.${payload}.mock-signature`
}

test('/api/auth/config retorna configuracao publica sem vazar service role', async () => {
  const app = createApp(baseConfig, async () => {
    throw new Error('should not call upstream')
  }, silentLogger)

  const res = await app.request('/api/auth/config')
  assert.equal(res.status, 200)
  const body = (await res.json()) as any
  assert.deepEqual(body, {
    authRequired: true,
    supabaseUrl: 'https://test-project.supabase.co',
    supabaseAnonKey: 'anon-public-key',
    turnstileSiteKey: 'test-turnstile-site-key',
  })
  // Garante que a service role key nunca aparece
  assert.equal('supabaseServiceRoleKey' in body, false)
})

test('rotas protegidas retornam 401 AUTH_REQUIRED quando token nao e enviado', async () => {
  const app = createApp(baseConfig, async () => {
    throw new Error('should not call upstream')
  }, silentLogger)

  const res = await app.request('/api/auth/me')
  assert.equal(res.status, 401)
  const body = (await res.json()) as any
  assert.equal(body.error?.code, 'AUTH_REQUIRED')
})

test('retorna 401 AUTH_INVALID quando token e rejeitado pelo Supabase', async () => {
  const app = createApp(baseConfig, async (input) => {
    const url = String(input)
    if (url.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ message: 'Invalid JWT' }), { status: 401 })
    }
    throw new Error(`Unexpected call to ${url}`)
  }, silentLogger)

  const res = await app.request('/api/auth/me', {
    headers: { Authorization: 'Bearer token-invalido' },
  })
  assert.equal(res.status, 401)
  const body = (await res.json()) as any
  assert.equal(body.error?.code, 'AUTH_INVALID')
})

test('retorna 403 GESTOR_ONLY quando cargo nao e gestor ou admin', async () => {
  const testUserId = '11111111-2222-3333-4444-555555555555'
  const token = makeJwt(testUserId)

  const app = createApp(baseConfig, async (input) => {
    const url = String(input)
    if (url.includes('/auth/v1/user')) {
      return Response.json({ id: testUserId, email: 'operador@sistema.mck' })
    }
    if (url.includes('/rest/v1/profiles')) {
      return Response.json([{ id: testUserId, nome: 'Operador Silva', cargo: 'operador' }])
    }
    throw new Error(`Unexpected call to ${url}`)
  }, silentLogger)

  const res = await app.request('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  assert.equal(res.status, 403)
  const body = (await res.json()) as any
  assert.equal(body.error?.code, 'GESTOR_ONLY')
  assert.match(body.error?.message, /restrito a gestores/i)
})

test('permite acesso com 200 quando cargo e gestor ou admin', async () => {
  const gestorId = '11111111-1111-1111-1111-111111111111'
  const adminId = '22222222-2222-2222-2222-222222222222'

  for (const [id, cargo, nome] of [
    [gestorId, 'gestor', 'Dra. Maria Gestora'],
    [adminId, 'admin', 'Administrador Chefe'],
  ] as const) {
    const token = makeJwt(id)
    const app = createApp(baseConfig, async (input) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) {
        return Response.json({ id })
      }
      if (url.includes('/rest/v1/profiles')) {
        return Response.json([{ id, nome, cargo }])
      }
      throw new Error(`Unexpected call to ${url}`)
    }, silentLogger)

    const res = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as any
    assert.deepEqual(body, {
      user: { id, nome, cargo },
    })
  }
})

test('cache em memoria evita segunda chamada ao Supabase para o mesmo token', async () => {
  const testUserId = '33333333-3333-3333-3333-333333333333'
  const token = makeJwt(testUserId)
  let calls = 0

  const app = createApp(baseConfig, async (input) => {
    calls += 1
    const url = String(input)
    if (url.includes('/auth/v1/user')) {
      return Response.json({ id: testUserId })
    }
    if (url.includes('/rest/v1/profiles')) {
      return Response.json([{ id: testUserId, nome: 'Gestor Teste', cargo: 'gestor' }])
    }
    throw new Error(`Unexpected call to ${url}`)
  }, silentLogger)

  const res1 = await app.request('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  assert.equal(res1.status, 200)
  assert.equal(calls, 2) // 1 /user + 1 /profiles

  const res2 = await app.request('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  assert.equal(res2.status, 200)
  assert.equal(calls, 2) // Nao chamou novamente
})

test('guard permanece desativado quando authRequired e false/undefined', async () => {
  const configWithoutAuth: ServerConfig = {
    ...baseConfig,
    authRequired: false,
  }

  const app = createApp(configWithoutAuth, async () => {
    return Response.json({ resultado: [{ valor: '2026', descricao: '2026' }] })
  }, silentLogger)

  const res = await app.request('/api/fns/anos')
  assert.equal(res.status, 200)
})

test('retorna 503 AUTH_NOT_CONFIGURED quando supabaseUrl esta ausente', async () => {
  const incompleteConfig: ServerConfig = {
    ...baseConfig,
    supabaseUrl: undefined,
    supabaseAnonKey: undefined,
    authRequired: true,
  }

  const app = createApp(incompleteConfig, async () => {
    throw new Error('should not call')
  }, silentLogger)

  const res = await app.request('/api/auth/me', {
    headers: { Authorization: 'Bearer token-qualquer' },
  })
  assert.equal(res.status, 503)
  const body = (await res.json()) as any
  assert.equal(body.error?.code, 'AUTH_NOT_CONFIGURED')
})
