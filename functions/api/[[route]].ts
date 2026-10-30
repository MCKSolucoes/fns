import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { createApp } from '../../server/app.js'
import { loadConfig, type ServerConfig } from '../../server/config.js'

const app = new Hono<{ Bindings: Record<string, string | undefined> }>()

let cachedApp: ReturnType<typeof createApp> | null = null

app.all('*', async (c) => {
  if (!cachedApp) {
    const rawEnv = (c.env || {}) as Record<string, string | undefined>
    const origin = rawEnv.FRONTEND_ORIGIN || new URL(c.req.url).origin
    const config: ServerConfig = loadConfig({
      ...rawEnv,
      FNS_TIMEOUT_MS: rawEnv.FNS_TIMEOUT_MS || '25000',
      FRONTEND_ORIGIN: origin,
    })
    cachedApp = createApp(config)
  }
  return cachedApp.fetch(c.req.raw)
})

export const onRequest = handle(app)
