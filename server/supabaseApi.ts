import { Hono, type Context } from 'hono'
import { createHash } from 'node:crypto'
import { getActivePartnerMunicipality } from '../src/data/partnerMunicipalities.js'
import type { ServerConfig } from './config.js'

interface Logger {
  info(message: string): void
  error(message: string): void
}

interface FnsFinancialPage {
  dados: Record<string, unknown>[]
  pagina: number
  itensPorPagina: number
  total: number
  totalPaginas: number
}

type Resource = keyof typeof resources

const resources = {
  profiles: { table: 'profiles', order: 'created_at.desc' },
  imports: { table: 'fns_importacoes', order: 'started_at.desc' },
  repasses: { table: 'fns_repasses', order: 'created_at.desc' },
  deputies: { table: 'deputados', order: 'created_at.desc' },
  amendments: { table: 'emendas_estaduais', order: 'created_at.desc' },
  baixas: { table: 'baixas', order: 'created_at.desc' },
  history: { table: 'baixa_historico', order: 'occurred_at.desc' },
  complements: { table: 'fns_financial_complements', order: 'updated_at.desc' },
  launches: { table: 'fns_financial_launches', order: 'created_at.desc' },
  reviews: { table: 'fns_installment_reviews', order: 'occurred_at.desc' },
  audit: { table: 'audit_logs', order: 'occurred_at.desc' },
} as const

const writableFields: Partial<Record<Resource, readonly string[]>> = {
  deputies: ['id', 'nome', 'partido', 'uf', 'observacoes'],
  amendments: ['id', 'legacy_id', 'uf', 'identificacao', 'valor', 'objeto', 'observacoes', 'deputado_id', 'legacy_created_at', 'legacy_updated_at'],
  baixas: [
    'id', 'legacy_id', 'repasse_id', 'repasse_snapshot', 'transfer_identifier',
    'deputado_id', 'deputado_nome_snapshot', 'emenda_id', 'emenda_snapshot',
    'beneficiary', 'document', 'paid_amount', 'payment_date', 'status', 'description',
    'document_reference', 'legacy_created_at', 'legacy_updated_at',
  ],
  complements: ['action_key', 'observations', 'review_status', 'review_responsible', 'internal_reference', 'legacy_updated_at'],
  launches: [
    'action_key', 'repasse_id', 'status', 'amount', 'launch_date', 'document_number',
    'account_reference', 'responsible', 'observations', 'legacy_created_at', 'legacy_updated_at',
  ],
  reviews: ['id', 'legacy_id', 'alert_key', 'status', 'justification', 'alert_snapshot'],
  history: [
    'id', 'legacy_id', 'baixa_id', 'transfer_identifier', 'event_type', 'occurred_at',
    'description', 'justification', 'previous_values', 'new_values', 'repasse_snapshot',
    'emenda_snapshot', 'deputado_nome_snapshot', 'baixa_snapshot',
  ],
  repasses: ['source_key', 'import_id', 'reference_year', 'reference_month', 'municipality_uf',
    'municipality_name', 'municipality_ibge', 'beneficiary_name', 'beneficiary_cnpj',
    'transfer_identifier', 'query_type', 'gross_amount', 'discount_amount', 'net_amount',
    'source_data', 'source_endpoint', 'consulted_at'],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFnsFinancialPage(value: unknown): value is FnsFinancialPage {
  return isRecord(value)
    && Array.isArray(value.dados)
    && value.dados.every(isRecord)
    && Number.isInteger(value.pagina)
    && Number.isInteger(value.itensPorPagina)
    && Number.isInteger(value.total)
    && Number.isInteger(value.totalPaginas)
}

function bearer(context: Context): string {
  const header = context.req.header('Authorization') ?? ''
  const match = /^Bearer\s+([^\s]+)$/i.exec(header)
  if (!match) throw new Error('AUTH_REQUIRED')
  return match[1]
}

function bearerOrTestMode(context: Context, config: ServerConfig): string {
  const authorization = context.req.header('Authorization')?.trim() ?? ''
  if ((!authorization || /^Bearer\s*$/i.test(authorization))
    && config.supabaseTestMode
    && config.supabaseServiceRoleKey) {
    return config.supabaseServiceRoleKey
  }
  return bearer(context)
}

function isAllowedFrontendOrigin(requestOrigin: string | undefined, configuredOrigin: string): boolean {
  if (requestOrigin === configuredOrigin) return true
  if (!requestOrigin) return false

  let requestUrl: URL
  let configuredUrl: URL
  try {
    requestUrl = new URL(requestOrigin)
    configuredUrl = new URL(configuredOrigin)
  } catch {
    return false
  }

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
  return requestUrl.origin === requestOrigin
    && requestUrl.protocol === configuredUrl.protocol
    && requestUrl.port === configuredUrl.port
    && loopbackHosts.has(requestUrl.hostname.toLowerCase())
    && loopbackHosts.has(configuredUrl.hostname.toLowerCase())
}

export function createSupabaseApi(
  config: ServerConfig,
  fetcher: typeof fetch = fetch,
  logger: Logger = console,
) {
  const app = new Hono()

  app.use('*', async (context, next) => {
    if (['POST', 'PATCH', 'DELETE'].includes(context.req.method)) {
      const requestOrigin = context.req.header('Origin')
      const requestedWith = context.req.header('X-Requested-With')
      if (!isAllowedFrontendOrigin(requestOrigin, config.frontendOrigin)
        || requestedWith !== 'XMLHttpRequest') {
        logger.error(JSON.stringify({
          event: 'request_origin_rejected',
          endpoint: context.req.path,
          method: context.req.method,
          origin: requestOrigin ?? null,
          configuredOrigin: config.frontendOrigin,
          requestedWithValid: requestedWith === 'XMLHttpRequest',
        }))
        return context.json({ error: { code: 'INVALID_ORIGIN', message: 'A origem da operação não foi validada.' } }, 403)
      }
    }
    await next()
  })

  function getSupabaseConfig() {
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error('SUPABASE_NOT_CONFIGURED')
    return { url: config.supabaseUrl, anonKey: config.supabaseAnonKey }
  }

  app.get('/storage/status', async (context) => {
    const configured = Boolean(config.supabaseTestMode && config.supabaseUrl && config.supabaseServiceRoleKey)
    if (!configured) {
      logger.error(JSON.stringify({
        event: 'shared_storage_check_failed',
        endpoint: '/storage/status',
        stage: 'configuration',
        errorCode: 'SUPABASE_NOT_CONFIGURED',
      }))
      return context.json({
        sharedStorageEnabled: false,
        error: { code: 'SUPABASE_NOT_CONFIGURED' },
      }, 503)
    }

    const token = config.supabaseServiceRoleKey
    if (!token) {
      return context.json({
        sharedStorageEnabled: false,
        error: { code: 'SUPABASE_NOT_CONFIGURED' },
      }, 503)
    }
    const probes = [
      { name: 'fns_repasses columns', path: '/rest/v1/fns_repasses?select=id,source_key,import_id,reference_year,reference_month,municipality_uf,municipality_name,municipality_ibge,beneficiary_name,beneficiary_cnpj,transfer_identifier,query_type,gross_amount,discount_amount,net_amount,source_data,source_endpoint,consulted_at,imported_at,created_at&limit=0' },
      { name: 'fns_importacoes columns', path: '/rest/v1/fns_importacoes?select=id,filters,status,records_found,records_imported,records_updated,records_ignored,errors,started_at,completed_at&limit=0' },
      { name: 'fns_financial_launches columns', path: '/rest/v1/fns_financial_launches?select=action_key,repasse_id,status,amount,launch_date,document_number,account_reference,responsible,observations,created_at,updated_at,legacy_created_at,legacy_updated_at&limit=0' },
      { name: 'fns_financial_complements columns', path: '/rest/v1/fns_financial_complements?select=action_key,observations,review_status,review_responsible,internal_reference,created_at,updated_at,legacy_updated_at&limit=0' },
      { name: 'fns_repasses import relationship', path: '/rest/v1/fns_repasses?select=id,fns_importacoes(id)&limit=0' },
      { name: 'fns_financial_launches repasse relationship', path: '/rest/v1/fns_financial_launches?select=action_key,fns_repasses(id)&limit=0' },
    ]
    try {
      for (const probe of probes) {
        try {
          await request(probe.path, token)
        } catch (error) {
          const errorCode = error instanceof Error ? error.message : 'SUPABASE_UNAVAILABLE'
          logger.error(JSON.stringify({
            event: 'shared_storage_check_failed',
            endpoint: '/storage/status',
            stage: 'schema_validation',
            probe: probe.name,
            errorCode,
          }))
          return context.json({
            sharedStorageEnabled: false,
            error: { code: errorCode },
          }, 503)
        }
      }
      return context.json({ sharedStorageEnabled: true })
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : 'SUPABASE_UNAVAILABLE'
      logger.error(JSON.stringify({
        event: 'shared_storage_check_failed',
        endpoint: '/storage/status',
        stage: 'configuration',
        errorCode,
      }))
      return context.json({
        sharedStorageEnabled: false,
        error: { code: errorCode },
      }, 503)
    }
  })

  async function request<T>(
    path: string,
    token: string,
    init: RequestInit = {},
    onResponse?: (response: Response) => void,
  ): Promise<T> {
    const supabase = getSupabaseConfig()
    const headers = new Headers(init.headers)
    headers.set('apikey', config.supabaseTestMode && token === config.supabaseServiceRoleKey
      ? token
      : supabase.anonKey)
    headers.set('Authorization', `Bearer ${token}`)
    headers.set('Accept', 'application/json')
    const startedAt = Date.now()
    const endpoint = new URL(path, supabase.url).pathname
    let response: Response
    try {
      response = await fetcher(`${supabase.url}${path}`, {
        ...init,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(8_000),
      })
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      logger.error(JSON.stringify({
        event: 'supabase_request_failed',
        endpoint,
        stage: timedOut ? 'timeout' : 'network',
        durationMs: Date.now() - startedAt,
        errorCode: timedOut ? 'SUPABASE_TIMEOUT' : 'SUPABASE_NETWORK_ERROR',
        errorMessage: timedOut ? 'Supabase request exceeded the 8000ms timeout.' : 'Supabase request could not be completed.',
      }))
      throw new Error(timedOut ? 'SUPABASE_TIMEOUT' : 'SUPABASE_UNAVAILABLE')
    }
    if (!response.ok) {
      let errorCode = ''
      let errorMessage = ''
      try {
        const body: unknown = await response.clone().json()
        if (isRecord(body)) {
          errorCode = typeof body.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(body.code) ? body.code : ''
          if (typeof body.message === 'string') {
            const message = body.message.replace(/[\r\n\t]+/g, ' ').trim()
            const missingTable = /^Could not find the table 'public\.[a-z_][a-z0-9_]{0,62}' in the schema cache$/.test(message)
            const safeMessage = ['Invalid API key', 'JWT expired'].includes(message)
            errorMessage = missingTable || safeMessage ? message : `Supabase returned HTTP ${response.status}.`
          }
        }
      } catch {
        errorMessage = 'Supabase returned a non-JSON error response.'
      }
      logger.error(JSON.stringify({
        event: 'supabase_request_failed',
        endpoint,
        stage: 'http_response',
        status: response.status,
        durationMs: Date.now() - startedAt,
        ...(errorCode ? { errorCode } : {}),
        ...(errorMessage ? { errorMessage } : {}),
      }))
      if (response.status === 401) throw new Error('SUPABASE_AUTH_FAILED')
      if (response.status === 403) throw new Error('SUPABASE_PERMISSION_DENIED')
      if (response.status === 409) throw new Error('DATA_CONFLICT')
      if (['PGRST205', '42P01'].includes(errorCode)) throw new Error('SUPABASE_TABLE_UNAVAILABLE')
      if (['PGRST204', '42703'].includes(errorCode)) throw new Error('SUPABASE_COLUMN_UNAVAILABLE')
      if (['PGRST200', '42830'].includes(errorCode)) throw new Error('SUPABASE_RELATION_UNAVAILABLE')
      if (errorCode === '42501') throw new Error('SUPABASE_PERMISSION_DENIED')
      if (response.status === 400 || response.status === 422) throw new Error('INVALID_DATA')
      throw new Error('SUPABASE_UNAVAILABLE')
    }
    onResponse?.(response)
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }

  function selectResource(value: string): Resource {
    if (!Object.hasOwn(resources, value)) throw new Error('RESOURCE_NOT_FOUND')
    return value as Resource
  }

  app.post('/fns/import', async (context) => {
    let token = ''
    let importId = ''
    try {
      token = bearerOrTestMode(context, config)
      const requestBody: unknown = await context.req.json()
      if (!isRecord(requestBody) || !isRecord(requestBody.filters) || !Array.isArray(requestBody.selectedIds)) {
        throw new Error('INVALID_IMPORT')
      }
      const filters = parseImportFilters(requestBody.filters)
      if (!requestBody.selectedIds.every((value) =>
        (typeof value === 'string' || typeof value === 'number') && String(value).trim().length > 0,
      )) throw new Error('INVALID_IMPORT')
      const selectedIds = [...new Set(requestBody.selectedIds.map(String))]
      if (selectedIds.length === 0 || selectedIds.length > 100) throw new Error('INVALID_IMPORT')

      const municipality = getActivePartnerMunicipality(filters.municipalityIbge, filters.uf)
      if (!municipality) throw new Error('MUNICIPALITY_NOT_AUTHORIZED')

      const created = await request<unknown>('/rest/v1/fns_importacoes', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          filters: {
            ano: filters.year,
            mes: filters.month,
            tipoConsulta: filters.queryType,
            estado: filters.uf,
            municipio: filters.municipalityIbge,
            cpfCnpjUg: filters.document,
            selectedIds,
          },
          status: 'em_andamento',
        }),
      })
      if (!Array.isArray(created) || !isRecord(created[0]) || typeof created[0].id !== 'string') {
        throw new Error('IMPORT_TRACKING_FAILED')
      }
      importId = created[0].id

      const actions = await fetchFnsActions(filters, municipality.ibgeCode.slice(0, 6), config, fetcher)
      const entity = await fetchFnsEntity(filters, municipality.ibgeCode.slice(0, 6), config, fetcher)
      const selectedById = new Map<string, Record<string, unknown>>()
      for (const action of actions) {
        const id = action.id
        if ((typeof id === 'string' || typeof id === 'number')
          && String(id).trim() !== ''
          && String(id) !== '0'
          && selectedIds.includes(String(id))) {
          selectedById.set(String(id), action)
        }
      }
      const selected = [...selectedById.values()]
      const selectedSet = new Set(selected.map((action) => String(action.id)))
      const ignored = selectedIds.length - selectedSet.size
      const now = new Date().toISOString()
      const records = selected.map((action) => ({
        source_key: sourceKey(filters, action.id),
        import_id: importId,
        reference_year: Number(filters.year),
        reference_month: filters.month ? Number(filters.month) : null,
        municipality_uf: municipality.uf,
        municipality_name: municipality.name,
        municipality_ibge: municipality.ibgeCode,
        beneficiary_name: entity.razaoSocial,
        beneficiary_cnpj: filters.document,
        transfer_identifier: String(action.id),
        query_type: filters.queryType || null,
        gross_amount: parseAmount(action.valorTotal),
        discount_amount: parseAmount(action.valorDescontoTotal),
        net_amount: parseAmount(action.valorLiquido),
        source_data: { record: action, entity, filters },
        source_endpoint: 'https://consultafns.saude.gov.br/recursos/consulta-detalhada/detalhe-acao',
        consulted_at: now,
      }))
      const keys = records.map((record) => record.source_key)
      const query = new URLSearchParams({
        select: 'source_key',
        source_key: `in.(${keys.map((key) => `"${key}"`).join(',')})`,
      })
      const existing = records.length
        ? await request<unknown>(`/rest/v1/fns_repasses?${query}`, token)
        : []
      const existingKeys = new Set(Array.isArray(existing) ? existing.flatMap((item) =>
        isRecord(item) && typeof item.source_key === 'string' ? [item.source_key] : [],
      ) : [])
      const upserted = records.length
        ? await request<unknown>('/rest/v1/fns_repasses?on_conflict=source_key', token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify(records),
        })
        : []
      if (!Array.isArray(upserted) || upserted.length !== records.length
        || !upserted.every((row) => isRecord(row) && keys.includes(String(row.source_key)))) {
        throw new Error('IMPORT_WRITE_FAILED')
      }
      const updated = records.filter((record) => existingKeys.has(record.source_key)).length
      const imported = records.length - updated
      const status = ignored > 0 ? 'parcial' : 'concluida'
      await request(`/rest/v1/fns_importacoes?id=eq.${encodeURIComponent(importId)}`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          status,
          records_found: actions.length,
          records_imported: imported,
          records_updated: updated,
          records_ignored: ignored,
          completed_at: new Date().toISOString(),
        }),
      })
      return context.json({
        importId,
        found: actions.length,
        imported,
        updated,
        ignored,
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (importId && token) {
        try {
          await request(`/rest/v1/fns_importacoes?id=eq.${encodeURIComponent(importId)}`, token, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({
              status: 'falhou',
              errors: [{ code: code === 'FNS_IMPORT_UNAVAILABLE' ? code : 'IMPORT_FAILED' }],
              completed_at: new Date().toISOString(),
            }),
          })
        } catch {
          logger.error(JSON.stringify({ event: 'fns_import_status_update_failed', importId }))
        }
      }
      if (code === 'AUTH_REQUIRED') return dataError(context, error, logger)
      if (code === 'SUPABASE_NOT_CONFIGURED') return dataError(context, error, logger)
      if (code === 'PERMISSION_DENIED' || code === 'SUPABASE_PERMISSION_DENIED') return dataError(context, error, logger)
      if (code === 'SUPABASE_AUTH_FAILED') return dataError(context, error, logger)
      if (code === 'INVALID_IMPORT') {
        return context.json({ error: { code, message: 'Selecione até 100 registros FNS identificados e informe filtros válidos.' } }, 400)
      }
      if (code === 'MUNICIPALITY_NOT_AUTHORIZED') {
        return context.json({ error: { code, message: 'O município não está autorizado para importação.' } }, 403)
      }
      if (code === 'FNS_IMPORT_UNAVAILABLE') {
        return context.json({ error: { code, message: 'A resposta atual do FNS falhou ou não pôde ser validada. Nenhum repasse foi importado.' } }, 502)
      }
      logger.error(JSON.stringify({ event: 'fns_import_failed', importId: importId || null, code: 'IMPORT_FAILED' }))
      return context.json({ error: { code: 'IMPORT_FAILED', message: 'A importação não foi concluída. Os registros válidos existentes foram preservados.' } }, 502)
    }
  })

  app.get('/data/:resource', async (context) => {
    try {
      const token = bearerOrTestMode(context, config)
      const resource = selectResource(context.req.param('resource'))
      if (resource === 'repasses') {
        const pageValue = context.req.query('page') ?? '1'
        const pageSizeValue = context.req.query('pageSize') ?? '50'
        if (!/^[1-9]\d*$/.test(pageValue) || !/^[1-9]\d*$/.test(pageSizeValue)
          || Number(pageSizeValue) > 100) {
          throw new Error('INVALID_FILTER')
        }
        const page = Number(pageValue)
        const pageSize = Number(pageSizeValue)
        const params = new URLSearchParams({
          select: '*',
          order: 'imported_at.desc',
          limit: String(pageSize),
          offset: String((page - 1) * pageSize),
        })
        const match = context.req.query('match')
        if (match !== undefined && match !== 'financialAction') throw new Error('INVALID_FILTER')
        if (match === 'financialAction') {
          const matchYear = context.req.query('matchYear') ?? ''
          const matchMonth = context.req.query('matchMonth') ?? ''
          const matchQueryType = context.req.query('matchQueryType') ?? ''
          const matchUf = (context.req.query('matchUf') ?? '').trim().toUpperCase()
          const matchMunicipalityIbge = context.req.query('matchMunicipalityIbge') ?? ''
          const matchBeneficiaryCnpj = (context.req.query('matchBeneficiaryCnpj') ?? '').replace(/\D/g, '')
          const matchTransferIdentifier = (context.req.query('matchTransferIdentifier') ?? '').trim()
          if (!/^\d{4}$/.test(matchYear)
            || (matchMonth !== 'null' && (!/^\d{1,2}$/.test(matchMonth) || Number(matchMonth) < 1 || Number(matchMonth) > 12))
            || (matchQueryType && !/^\d+$/.test(matchQueryType))
            || !/^[A-Z]{2}$/.test(matchUf)
            || !/^\d{7}$/.test(matchMunicipalityIbge)
            || ![11, 14].includes(matchBeneficiaryCnpj.length)
            || !matchTransferIdentifier || matchTransferIdentifier.length > 120
            || pageSize > 2) {
            throw new Error('INVALID_FILTER')
          }
          params.set('reference_year', `eq.${matchYear}`)
          params.set('reference_month', matchMonth === 'null' ? 'is.null' : `eq.${Number(matchMonth)}`)
          params.set('query_type', matchQueryType ? `eq.${matchQueryType}` : 'is.null')
          params.set('municipality_uf', `eq.${matchUf}`)
          params.set('municipality_ibge', `eq.${matchMunicipalityIbge}`)
          params.set('beneficiary_cnpj', `eq.${matchBeneficiaryCnpj}`)
          params.set('transfer_identifier', `eq.${matchTransferIdentifier}`)
        }
        const year = context.req.query('year') ?? ''
        const month = context.req.query('month') ?? ''
        const uf = (context.req.query('uf') ?? '').trim().toUpperCase()
        if (year && !/^\d{4}$/.test(year)) throw new Error('INVALID_FILTER')
        if (month && (!/^\d{1,2}$/.test(month) || Number(month) < 1 || Number(month) > 12)) {
          throw new Error('INVALID_FILTER')
        }
        if (uf && !/^[A-Z]{2}$/.test(uf)) throw new Error('INVALID_FILTER')
        if (year) params.set('reference_year', `eq.${year}`)
        if (month) params.set('reference_month', `eq.${Number(month)}`)
        if (uf) params.set('municipality_uf', `eq.${uf}`)
        const query = (context.req.query('query') ?? '')
          .normalize('NFC')
          .replace(/[^\p{L}\p{N}\s-]/gu, '')
          .trim()
          .slice(0, 80)
        if (query) {
          const pattern = `*${query.replace(/\s+/g, '*')}*`
          params.set('or', `(municipality_name.ilike.${pattern},beneficiary_name.ilike.${pattern},beneficiary_cnpj.ilike.${pattern},transfer_identifier.ilike.${pattern})`)
        }
        let total: number | undefined
        const rows = await request<unknown>(`/rest/v1/fns_repasses?${params}`, token, {
          headers: { Prefer: 'count=exact' },
        }, (response) => {
          const range = response.headers.get('content-range')
          const match = range ? /\/(\d+)$/.exec(range) : null
          if (match) total = Number(match[1])
        })
        if (!Array.isArray(rows) || total === undefined) throw new Error('COUNT_UNAVAILABLE')
        return context.json({ items: rows, total, page, pageSize })
      }
      const params = new URLSearchParams({ select: '*', order: resources[resource].order, limit: '1000' })
      if (resource === 'complements' || resource === 'launches') {
        const key = context.req.query('key')
        if (key !== undefined) {
          if (!key.trim() || key.length > 256) throw new Error('INVALID_FILTER')
          params.set('action_key', `eq.${key}`)
          params.set('limit', '1')
        }
      }
      const rows = await request<unknown>(`/rest/v1/${resources[resource].table}?${params}`, token)
      return context.json(rows)
    } catch (error) {
      return dataError(context, error, logger)
    }
  })

  app.post('/data/:resource', async (context) => {
    try {
      const token = bearerOrTestMode(context, config)
      const resource = selectResource(context.req.param('resource'))
      if (!writableFields[resource]) throw new Error('RESOURCE_READ_ONLY')
      const body: unknown = await context.req.json()
      const payload = sanitizePayload(resource, body)
      if (resource === 'launches') validateFinancialLaunchPayload(payload)
      const conflictColumn = resource === 'repasses' ? 'source_key'
        : resource === 'history' || resource === 'reviews' || resource === 'amendments' || resource === 'baixas' ? 'legacy_id'
          : resource === 'complements' || resource === 'launches' ? 'action_key'
            : ''
      const query = conflictColumn ? `?on_conflict=${conflictColumn}` : ''
      const prefer = conflictColumn
        ? `${resource === 'history' ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates'},return=representation`
        : 'return=representation'
      const rows = await request<unknown>(`/rest/v1/${resources[resource].table}${query}`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: prefer },
        body: JSON.stringify(payload),
      })
      return context.json(rows, 201)
    } catch (error) {
      return dataError(context, error, logger)
    }
  })

  app.patch('/data/:resource/:id', async (context) => {
    try {
      const token = bearerOrTestMode(context, config)
      const resource = selectResource(context.req.param('resource'))
      if (!writableFields[resource] || resource === 'history') throw new Error('RESOURCE_READ_ONLY')
      const payload = sanitizePayload(resource, await context.req.json())
      if (resource === 'launches') validateFinancialLaunchPayload(payload)
      const idColumn = resource === 'complements' || resource === 'launches' ? 'action_key' : 'id'
      const query = new URLSearchParams({ [idColumn]: `eq.${context.req.param('id')}` })
      const rows = await request<unknown>(`/rest/v1/${resources[resource].table}?${query}`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      })
      return context.json(rows)
    } catch (error) {
      return dataError(context, error, logger)
    }
  })

  app.delete('/data/:resource/:id', async (context) => {
    try {
      const token = bearerOrTestMode(context, config)
      const resource = selectResource(context.req.param('resource'))
      if (!writableFields[resource] || resource === 'history') throw new Error('RESOURCE_READ_ONLY')
      const idColumn = resource === 'complements' || resource === 'launches' ? 'action_key' : 'id'
      const query = new URLSearchParams({ [idColumn]: `eq.${context.req.param('id')}` })
      const rows = await request<unknown>(`/rest/v1/${resources[resource].table}?${query}`, token, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' },
      })
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error('DATA_NOT_FOUND')
      return context.json(rows)
    } catch (error) {
      return dataError(context, error, logger)
    }
  })

  return app
}

interface ImportFilters {
  year: string
  month: string
  queryType: string
  uf: string
  municipalityIbge: string
  document: string
}

function parseImportFilters(value: Record<string, unknown>): ImportFilters {
  const year = typeof value.ano === 'string' ? value.ano.trim() : ''
  const month = typeof value.mes === 'string' ? value.mes.trim() : ''
  const queryType = typeof value.tipoConsulta === 'string' ? value.tipoConsulta.trim() : ''
  const uf = typeof value.estado === 'string' ? value.estado.trim().toUpperCase() : ''
  const municipalityIbge = typeof value.municipio === 'string' ? value.municipio.trim() : ''
  const document = typeof value.cpfCnpjUg === 'string' || typeof value.cpfCnpjUg === 'number'
    ? String(value.cpfCnpjUg).replace(/\D/g, '')
    : ''
  if (!/^\d{4}$/.test(year)
    || (month && (!/^\d{1,2}$/.test(month) || Number(month) < 1 || Number(month) > 12))
    || (queryType && !/^\d+$/.test(queryType))
    || !/^[A-Z]{2}$/.test(uf)
    || !/^\d{7}$/.test(municipalityIbge)
    || ![11, 14].includes(document.length)) {
    throw new Error('INVALID_IMPORT')
  }
  return { year, month, queryType, uf, municipalityIbge, document }
}

function sourceKey(filters: ImportFilters, identifier: unknown): string {
  if (typeof identifier !== 'string' && typeof identifier !== 'number') throw new Error('INVALID_IMPORT')
  const stableId = String(identifier).trim()
  if (!stableId || stableId === '0') throw new Error('INVALID_IMPORT')
  const identity = JSON.stringify([
    filters.year,
    filters.month,
    filters.queryType,
    filters.uf,
    filters.municipalityIbge,
    filters.document,
    stableId,
  ])
  return createHash('sha256').update(identity, 'utf8').digest('hex')
}

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

async function fetchFnsActions(
  filters: ImportFilters,
  fnsMunicipalityCode: string,
  config: ServerConfig,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>[]> {
  const actions: Record<string, unknown>[] = []
  let expectedTotal: number | undefined
  let expectedPages: number | undefined
  const count = 100
  const pageLimit = 200
  for (let page = 1; page <= (expectedPages ?? 1); page += 1) {
    const params = new URLSearchParams({
      ano: filters.year,
      count: String(count),
      cpfCnpjUg: filters.document,
      estado: filters.uf,
      municipio: fnsMunicipalityCode,
      page: String(page),
      tipoConsulta: filters.queryType,
    })
    if (filters.month) params.set('mes', filters.month)
    const body = await fetchFnsJson(
      `https://consultafns.saude.gov.br/recursos/consulta-detalhada/detalhe-acao?${params}`,
      config,
      fetcher,
    )
    const result = isRecord(body) && isRecord(body.resultado) ? body.resultado : body
    if (!isFnsFinancialPage(result)) throw new Error('FNS_IMPORT_UNAVAILABLE')
    if (result.pagina !== page
      || (expectedTotal !== undefined && result.total !== expectedTotal)
      || (expectedPages !== undefined && result.totalPaginas !== expectedPages)) {
      throw new Error('FNS_IMPORT_UNAVAILABLE')
    }
    expectedTotal = result.total
    expectedPages = result.totalPaginas
    if (expectedPages > pageLimit) throw new Error('FNS_IMPORT_UNAVAILABLE')
    actions.push(...result.dados)
  }
  if (expectedTotal !== undefined && actions.length !== expectedTotal) throw new Error('FNS_IMPORT_UNAVAILABLE')
  return actions
}

async function fetchFnsEntity(
  filters: ImportFilters,
  fnsMunicipalityCode: string,
  config: ServerConfig,
  fetcher: typeof fetch,
): Promise<Record<string, unknown> & { razaoSocial: string }> {
  const params = new URLSearchParams({
    ano: filters.year,
    count: '100',
    cpfCnpjUg: filters.document,
    estado: filters.uf,
    municipio: fnsMunicipalityCode,
    page: '1',
    tipoConsulta: filters.queryType,
  })
  if (filters.month) params.set('mes', filters.month)
  const body = await fetchFnsJson(
    `https://consultafns.saude.gov.br/recursos/consulta-detalhada/entidades?${params}`,
    config,
    fetcher,
  )
  const result = isRecord(body) && isRecord(body.resultado) ? body.resultado : body
  const firstPage = isFnsFinancialPage(result)
    && (result.pagina === 1 || (result.pagina === 0 && result.totalPaginas === 1))
  if (!firstPage) throw new Error('FNS_IMPORT_UNAVAILABLE')
  const entity = result.dados.find((item) => {
    const document = String(item.cpfCnpjFormatado ?? item.cpfCnpj ?? '').replace(/\D/g, '')
    if (document !== filters.document) return false
    const municipality = String(item.codigoMunicipioIBGE ?? '').replace(/\D/g, '')
    return !municipality || municipality.slice(0, 6) === fnsMunicipalityCode
  })
  if (!entity || typeof entity.razaoSocial !== 'string' || !entity.razaoSocial.trim()) {
    throw new Error('FNS_IMPORT_UNAVAILABLE')
  }
  return { ...entity, razaoSocial: entity.razaoSocial.trim() }
}

async function fetchFnsJson(url: string, config: ServerConfig, fetcher: typeof fetch): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.fnsTimeoutMs),
      redirect: 'manual',
    })
  } catch {
    throw new Error('FNS_IMPORT_UNAVAILABLE')
  }
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error('FNS_IMPORT_UNAVAILABLE')
  }
  try {
    return await response.json() as unknown
  } catch {
    throw new Error('FNS_IMPORT_UNAVAILABLE')
  }
}

function sanitizePayload(resource: Resource, value: unknown): Record<string, unknown> | Record<string, unknown>[] {
  if (!isRecord(value) && !Array.isArray(value)) throw new Error('INVALID_DATA')
  const fields = writableFields[resource]
  if (!fields) throw new Error('RESOURCE_READ_ONLY')
  const sanitize = (record: unknown) => {
    if (!isRecord(record)) throw new Error('INVALID_DATA')
    return Object.fromEntries(Object.entries(record).filter(([key]) => fields.includes(key)))
  }
  return Array.isArray(value) ? value.map(sanitize) : sanitize(value)
}

function validateFinancialLaunchPayload(value: Record<string, unknown> | Record<string, unknown>[]): void {
  if (Array.isArray(value)) throw new Error('INVALID_FINANCIAL_LAUNCH')
  const statuses = ['Pendente', 'Em análise', 'Conferido', 'Lançado']
  const date = value.launch_date
  const validDate = date === null || (typeof date === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))
    && new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date)
  const repasseId = value.repasse_id
  if (typeof value.action_key !== 'string' || !/^[a-f\d]{64}$/i.test(value.action_key)
    || typeof value.status !== 'string' || !statuses.includes(value.status)
    || typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount < 0
    || !validDate
    || typeof value.document_number !== 'string' || value.document_number.length > 120
    || typeof value.account_reference !== 'string' || value.account_reference.length > 160
    || typeof value.responsible !== 'string' || value.responsible.length > 120
    || typeof value.observations !== 'string' || value.observations.length > 2000
    || typeof repasseId !== 'string' || !/^[\w.:-]{1,128}$/.test(repasseId)) {
    throw new Error('INVALID_FINANCIAL_LAUNCH')
  }
}

function dataError(context: Context, error: unknown, logger: Logger) {
  const code = error instanceof Error ? error.message : ''
  if (code === 'AUTH_REQUIRED') {
    return context.json({ error: { code: 'AUTH_REQUIRED', message: 'Integre uma sessão autenticada do Supabase para acessar estes dados.' } }, 401)
  }
  if (code === 'SUPABASE_NOT_CONFIGURED') {
    return context.json({ error: { code: 'SUPABASE_NOT_CONFIGURED', message: 'A conexão Supabase ainda não foi configurada no servidor.' } }, 503)
  }
  if (code === 'SUPABASE_TABLE_UNAVAILABLE') {
    return context.json({ error: { code: 'SUPABASE_TABLE_UNAVAILABLE', message: 'Uma tabela necessária ainda não está disponível no Supabase.' } }, 503)
  }
  if (code === 'SUPABASE_COLUMN_UNAVAILABLE') {
    return context.json({ error: { code: 'SUPABASE_COLUMN_UNAVAILABLE', message: 'Uma coluna necessária ainda não está disponível no Supabase.' } }, 503)
  }
  if (code === 'SUPABASE_RELATION_UNAVAILABLE') {
    return context.json({ error: { code: 'SUPABASE_RELATION_UNAVAILABLE', message: 'Um relacionamento necessário ainda não está disponível no Supabase.' } }, 503)
  }
  if (code === 'SUPABASE_AUTH_FAILED') {
    return context.json({ error: { code: 'SUPABASE_AUTH_FAILED', message: 'A conexão do servidor com o Supabase não foi autenticada.' } }, 503)
  }
  if (code === 'SUPABASE_PERMISSION_DENIED') {
    return context.json({ error: { code: 'SUPABASE_PERMISSION_DENIED', message: 'O Supabase negou acesso a uma operação necessária.' } }, 503)
  }
  if (code === 'SUPABASE_TIMEOUT') {
    return context.json({ error: { code: 'SUPABASE_TIMEOUT', message: 'O Supabase demorou para responder. Tente novamente.' } }, 504)
  }
  if (code === 'PERMISSION_DENIED' || code === 'SUPABASE_PERMISSION_DENIED') {
    return context.json({ error: { code: 'PERMISSION_DENIED', message: 'O Supabase recusou esta operação pelas políticas de acesso.' } }, 403)
  }
  if (code === 'INVALID_DATA') {
    return context.json({ error: { code: 'INVALID_DATA', message: 'Os dados enviados são inválidos.' } }, 400)
  }
  if (code === 'INVALID_FILTER') {
    return context.json({ error: { code: 'INVALID_FILTER', message: 'Os filtros ou a paginação dos repasses são inválidos.' } }, 400)
  }
  if (code === 'INVALID_FINANCIAL_LAUNCH') {
    return context.json({ error: { code: 'INVALID_FINANCIAL_LAUNCH', message: 'Revise os campos internos do lançamento financeiro antes de salvar.' } }, 400)
  }
  if (code === 'COUNT_UNAVAILABLE') {
    return context.json({ error: { code: 'COUNT_UNAVAILABLE', message: 'O Supabase não informou a quantidade total para esta consulta.' } }, 502)
  }
  if (code === 'DATA_CONFLICT') {
    return context.json({ error: { code: 'DATA_CONFLICT', message: 'Já existe um registro com esses dados.' } }, 409)
  }
  if (code === 'DATA_NOT_FOUND') {
    return context.json({ error: { code: 'DATA_NOT_FOUND', message: 'Nenhum registro correspondente foi alterado no banco de dados.' } }, 404)
  }
  if (code === 'RESOURCE_READ_ONLY') {
    return context.json({ error: { code: 'RESOURCE_READ_ONLY', message: 'Este recurso não pode ser alterado por esta API.' } }, 403)
  }
  if (code === 'RESOURCE_NOT_FOUND') {
    return context.json({ error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } }, 404)
  }
  if (code === 'INVALID_ORIGIN') {
    return context.json({ error: { code: 'INVALID_ORIGIN', message: 'A origem da operação não foi validada.' } }, 403)
  }
  logger.error(JSON.stringify({ event: 'supabase_data_request_failed', code: 'SUPABASE_UNAVAILABLE' }))
  return context.json({ error: { code: 'SUPABASE_UNAVAILABLE', message: 'Não foi possível acessar o banco de dados compartilhado.' } }, 502)
}
