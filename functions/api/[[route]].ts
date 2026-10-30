import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { createApp } from '../../server/app.js'
import { loadConfig, type ServerConfig } from '../../server/config.js'

const app = new Hono<{ Bindings: Record<string, string | undefined> }>()

let cachedApp: ReturnType<typeof createApp> | null = null
let cachedConfigured = false

app.all('*', async (c) => {
  const rawEnv = (c.env || {}) as Record<string, string | undefined>
  const origin = rawEnv.FRONTEND_ORIGIN || new URL(c.req.url).origin

  if (!cachedApp || !cachedConfigured) {
    const config: ServerConfig = loadConfig({
      ...rawEnv,
      FRONTEND_ORIGIN: origin,
    })
    const appInstance = createApp(config)
    if (config.supabaseUrl && config.supabaseAnonKey) {
      cachedApp = appInstance
      cachedConfigured = true
    }
    return appInstance.fetch(c.req.raw)
  }
  return cachedApp.fetch(c.req.raw)
})

export const onRequest = handle(app)

