import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = createApp(config)

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.info(JSON.stringify({ event: 'server_started', host: info.address, port: info.port }))
})