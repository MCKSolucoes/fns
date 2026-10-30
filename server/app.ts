import { cors } from 'hono/cors'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type {
  AnoOption,
  FnsResourceEnvelope,
  MesOption,
  RepasseOption,
  TipoConsultaOption,
  UfOption,
} from '../src/types/fnsResources.js'
import type { FnsMunicipalLeadership, FnsMunicipalLeadershipResponse } from '../src/types/fnsLeadership.js'
import { getActivePartnerMunicipality, getActivePartnerMunicipalities, partnerStates } from '../src/data/partnerMunicipalities.js'
import type { ServerConfig } from './config.js'
import { createSupabaseApi } from './supabaseApi.js'
import { createAuth } from './auth.js'

const FNS_RESOURCES_BASE = 'https://consultafns.saude.gov.br/recursos'
const RESOURCE_CACHE_TTL_MS = 6 * 60 * 60 * 1000

interface BlocoOption {
  id: string
  nome: string
}

interface FnsConsultationResponse {
  dados: Record<string, unknown>[]
  pagina: number
  itensPorPagina: number
  total: number
  totalPaginas: number
}

interface FnsFinancialResponse {
  dados: Record<string, unknown>[]
  pagina: number
  itensPorPagina: number
  total: number
  totalPaginas: number
}

interface Logger {
  info(message: string): void
  error(message: string): void
}

class ApiError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string
  readonly retryable: boolean

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    retryable = false,
  ) {
    super(message)
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAno(value: unknown): value is AnoOption {
  return isRecord(value) && typeof value.valor === 'string' && typeof value.descricao === 'string'
}

function isTipoConsulta(value: unknown): value is TipoConsultaOption {
  return isRecord(value) && typeof value.valor === 'number' && typeof value.descricao === 'string'
}

function isRepasse(value: unknown): value is RepasseOption {
  return isRecord(value) && typeof value.valor === 'number' && typeof value.descricao === 'string'
}

function isUf(value: unknown): value is UfOption {
  return isRecord(value)
    && typeof value.coUfIbge === 'string'
    && typeof value.sigla === 'string'
    && typeof value.nome === 'string'
    && typeof value.registroAtivo === 'string'
    && typeof value.id === 'string'
}

function isMes(value: unknown): value is MesOption {
  return isRecord(value) && typeof value.descricao === 'string' && typeof value.valor === 'number'
}

function isBloco(value: unknown): value is BlocoOption {
  return isRecord(value) && typeof value.id === 'string' && typeof value.nome === 'string'
}

function isEnvelope<T>(value: unknown, isItem: (item: unknown) => item is T): value is FnsResourceEnvelope<T> {
  return isRecord(value) && Array.isArray(value.resultado) && value.resultado.every(isItem)
}

function isFnsConsultationResponse(value: unknown): value is FnsConsultationResponse {
  return isRecord(value)
    && Array.isArray(value.dados)
    && value.dados.every(isRecord)
    && ['pagina', 'itensPorPagina', 'total', 'totalPaginas'].every((key) =>
      Number.isInteger(value[key]) && Number(value[key]) >= 0,
    )
}

function isFnsFinancialResponse(value: unknown): value is FnsFinancialResponse {
  return isFnsConsultationResponse(value)
}

function isFnsMunicipalLeadership(value: unknown): value is FnsMunicipalLeadership {
  if (!isRecord(value)) return false
  return (
    (value.nome === undefined || value.nome === null || typeof value.nome === 'string')
    && (value.cargo === undefined || value.cargo === null || typeof value.cargo === 'string')
    && (value.inicioMandato === undefined || value.inicioMandato === null || typeof value.inicioMandato === 'number')
    && (value.inicioMandatoFormatado === undefined || value.inicioMandatoFormatado === null || typeof value.inicioMandatoFormatado === 'string')
    && (value.noSecretario === undefined || value.noSecretario === null || typeof value.noSecretario === 'string')
    && (value.noPresidenteConselho === undefined || value.noPresidenteConselho === null || typeof value.noPresidenteConselho === 'string')
  )
}

function normalizeFnsMunicipalLeadership(value: unknown): FnsMunicipalLeadershipResponse {
  if (!isRecord(value) || !Object.hasOwn(value, 'resultado')) {
    throw new ApiError(502, 'FNS_INVALID_RESPONSE', 'O portal FNS retornou dados de dirigentes em formato inesperado.')
  }
  if (value.resultado === null) return { resultado: null }
  if (!isFnsMunicipalLeadership(value.resultado)) {
    throw new ApiError(502, 'FNS_INVALID_RESPONSE', 'O portal FNS retornou dados de dirigentes em formato inesperado.')
  }
  const leadership = value.resultado
  const normalized: FnsMunicipalLeadership = {
    ...(typeof leadership.nome === 'string' ? { nome: leadership.nome } : {}),
    ...(typeof leadership.cargo === 'string' ? { cargo: leadership.cargo } : {}),
    ...(typeof leadership.inicioMandato === 'number' ? { inicioMandato: leadership.inicioMandato } : {}),
    ...(typeof leadership.inicioMandatoFormatado === 'string' ? { inicioMandatoFormatado: leadership.inicioMandatoFormatado } : {}),
    ...(typeof leadership.noSecretario === 'string' ? { noSecretario: leadership.noSecretario } : {}),
    ...(typeof leadership.noPresidenteConselho === 'string' ? { noPresidenteConselho: leadership.noPresidenteConselho } : {}),
  }
  const hasValues = Object.values(normalized).some((field) => field !== '')
  return { resultado: hasValues ? normalized : null }
}

export function fnsMunicipalityCode(code: string): string {
  const municipality = getActivePartnerMunicipality(code)
  if (!municipality) throw new Error('Código IBGE não autorizado para consulta.')
  return municipality.ibgeCode.slice(0, 6)
}

function requirePartnerMunicipality(ufValue: string | undefined, municipalityValue: string | undefined) {
  const uf = ufValue?.trim().toUpperCase() ?? ''
  const code = municipalityValue?.trim() ?? ''
  if (!uf || !code) {
    throw new ApiError(400, 'PARTNER_MUNICIPALITY_REQUIRED', 'Selecione um município parceiro ativo antes de consultar o FNS.')
  }
  if (!/^\d{7}$/.test(code)) {
    throw new ApiError(400, 'INVALID_MUNICIPALITY', 'Informe o código IBGE oficial de sete dígitos do município.')
  }
  const municipality = getActivePartnerMunicipality(code, uf)
  if (!municipality) {
    throw new ApiError(403, 'MUNICIPALITY_NOT_AUTHORIZED', 'O município informado não está autorizado para consultas nesta aplicação.')
  }
  return municipality
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)
}

function isConnectionError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (!isRecord(error) || typeof error.code !== 'string') return false
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code)
}

function sanitizedUrl(value: string): string {
  const url = new URL(value)
  url.username = ''
  url.password = ''
  for (const key of url.searchParams.keys()) {
    if (/token|key|secret|password|credential|authorization/i.test(key)) url.searchParams.set(key, '[REDACTED]')
  }
  return url.toString()
}

function sanitizedBodyPreview(body: string): string {
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redact)
    if (!isRecord(value)) return typeof value === 'string'
      ? value.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      : value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /token|key|secret|password|credential|authorization|cookie/i.test(key) ? '[REDACTED]' : redact(item),
    ]))
  }
  try {
    return JSON.stringify(redact(JSON.parse(body))).slice(0, 500)
  } catch {
    return body
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/((?:token|key|secret|password|credential|authorization|cookie)\s*[=:]\s*)[^&\s,;]+/gi, '$1[REDACTED]')
      .slice(0, 500)
  }
}

export function createApp(
  config: ServerConfig,
  fetcher: typeof fetch = fetch,
  logger: Logger = console,
) {
  const app = new Hono()
  const responseCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>()

  function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = responseCache.get(key)
    if (existing && existing.expiresAt > Date.now()) return existing.promise as Promise<T>

    const promise = Promise.resolve().then(load)
    responseCache.set(key, { expiresAt: Date.now() + RESOURCE_CACHE_TTL_MS, promise })
    promise.catch(() => {
      if (responseCache.get(key)?.promise === promise) responseCache.delete(key)
    })
    return promise
  }

  app.use('/api/*', cors({
    origin: config.frontendOrigin,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Accept', 'Authorization', 'Content-Type', 'X-Requested-With'],
    maxAge: 600,
  }))

  app.use('/api/*', async (context, next) => {
    const startedAt = Date.now()
    await next()
    logger.info(JSON.stringify({
      method: context.req.method,
      path: context.req.path,
      status: context.res.status,
      durationMs: Date.now() - startedAt,
    }))
  })

  const auth = createAuth(config, fetcher, logger)
  app.use('/api/*', auth.guard)
  app.route('/api', auth.api)
  app.route('/api', createSupabaseApi(config, fetcher, logger))

  async function fetchJson(url: string, source = 'O portal FNS'): Promise<unknown> {
    const codePrefix = source === 'O portal FNS' ? 'FNS' : 'IBGE'
    const maxAttempts = 2
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now()
      let response: Response
      try {
        response = await fetcher(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            Referer: 'https://consultafns.saude.gov.br/',
          },
          signal: AbortSignal.timeout(config.fnsTimeoutMs),
          redirect: 'manual',
        })
      } catch (error) {
        const timeout = isTimeout(error)
        const connectionError = isConnectionError(error)
        const retryable = timeout || connectionError
        logger.error(JSON.stringify({
          event: 'fns_upstream_error',
          url: sanitizedUrl(url),
          attempt,
          maxAttempts,
          timeoutMs: config.fnsTimeoutMs,
          durationMs: Date.now() - startedAt,
          reason: timeout ? 'timeout' : connectionError ? 'connection' : 'unexpected',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }))
        if (retryable && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 150 * attempt))
          continue
        }
        if (timeout) throw new ApiError(504, `${codePrefix}_TIMEOUT`, `${source} não respondeu dentro do prazo.`, true)
        throw new ApiError(502, `${codePrefix}_UNAVAILABLE`, `Não foi possível conectar ${source.toLowerCase()}.`, connectionError)
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '[corpo indisponível]')
        const retryable = [502, 503, 504].includes(response.status)
        logger.error(JSON.stringify({
          event: 'fns_upstream_error',
          url: sanitizedUrl(url),
          attempt,
          maxAttempts,
          timeoutMs: config.fnsTimeoutMs,
          durationMs: Date.now() - startedAt,
          upstreamStatus: response.status,
          contentType: response.headers.get('content-type'),
          bodyPreview: sanitizedBodyPreview(body),
        }))
        if (retryable && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 150 * attempt))
          continue
        }
        const status = response.status as ContentfulStatusCode
        const message = response.status === 503
          ? `${source} está temporariamente indisponível (HTTP 503).`
          : response.status === 504
            ? `${source} não respondeu dentro do prazo (HTTP 504).`
            : response.status === 502
              ? `${source} está temporariamente indisponível (HTTP 502).`
              : `${source} respondeu com HTTP ${response.status}.`
        throw new ApiError(status, `${codePrefix}_UNAVAILABLE`, message, retryable)
      }

      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        throw new ApiError(502, `${codePrefix}_INVALID_RESPONSE`, `${source} retornou um conteúdo que não é JSON.`)
      }

      try {
        return await response.json() as unknown
      } catch {
        throw new ApiError(502, `${codePrefix}_INVALID_RESPONSE`, `${source} retornou um JSON inválido.`)
      }
    }

    throw new ApiError(502, `${codePrefix}_UNAVAILABLE`, `Não foi possível conectar ${source.toLowerCase()}.`, true)
  }

  async function getResource<T>(path: string, isItem: (item: unknown) => item is T): Promise<FnsResourceEnvelope<T>> {
    const body = await fetchJson(`${FNS_RESOURCES_BASE}${path}`)
    if (!isEnvelope(body, isItem)) {
      throw new ApiError(502, 'FNS_INVALID_RESPONSE', 'O portal FNS retornou dados em formato inesperado.')
    }
    return body
  }

  app.get('/api/fns/anos', async (context) => context.json(await getResource('/anos', isAno)))
  app.get('/api/fns/tipos-consulta/:ano', async (context) => {
    const { ano } = context.req.param()
    if (!/^\d{4}$/.test(ano)) throw new ApiError(400, 'INVALID_YEAR', 'O ano deve conter quatro dígitos.')
    return context.json(await getResource(`/tipos-consulta/${ano}`, isTipoConsulta))
  })
  app.get('/api/fns/repasses', async (context) => context.json(await getResource('/repasses', isRepasse)))
  app.get('/api/fns/consultas', async (context) => {
    const incoming = context.req.query()
    const partnerMunicipality = requirePartnerMunicipality(incoming.estado, incoming.municipio)
    const year = incoming.ano ?? ''
    const month = incoming.mes ?? ''
    const consultationType = incoming.tipoConsulta ?? ''
    const page = incoming.page ?? '1'
    const count = incoming.count ?? '8'
    if (year && !/^\d{4}$/.test(year)) throw new ApiError(400, 'INVALID_YEAR', 'O ano deve conter quatro dígitos.')
    if (month && (!/^\d{1,2}$/.test(month) || Number(month) < 1 || Number(month) > 12)) {
      throw new ApiError(400, 'INVALID_MONTH', 'Informe um mês válido entre 1 e 12.')
    }
    if (consultationType && !/^\d+$/.test(consultationType)) {
      throw new ApiError(400, 'INVALID_CONSULTATION_TYPE', 'Informe um tipo de consulta válido.')
    }
    if (!/^[1-9]\d*$/.test(page)) throw new ApiError(400, 'INVALID_PAGE', 'A página deve ser um inteiro positivo.')
    if (!/^[1-9]\d*$/.test(count) || Number(count) > 100) {
      throw new ApiError(400, 'INVALID_COUNT', 'A quantidade por página deve estar entre 1 e 100.')
    }

    const params = new URLSearchParams()
    const filters = [
      ['ano', year],
      ['mes', month],
      ['tipoConsulta', consultationType],
      ['estado', partnerMunicipality.uf],
      ['municipio', fnsMunicipalityCode(partnerMunicipality.ibgeCode)],
      ['blocos', incoming.blocos ?? ''],
      ['grupo', incoming.grupo ?? ''],
      ['cpfCnpjUg', incoming.cpfCnpjUg ?? ''],
      ['processo', incoming.processo ?? ''],
      ['proposta', incoming.proposta ?? ''],
      ['repasse', incoming.repasse ?? ''],
      ['dataInicialOb', incoming.dataInicialOb ?? ''],
      ['dataFinalOb', incoming.dataFinalOb ?? ''],
      ['portaria', incoming.portaria ?? ''],
    ] as const
    for (const [key, value] of filters) {
      if (value.trim()) params.set(key, value.trim())
    }
    params.set('page', page)
    params.set('count', count)

    const upstreamBody = await fetchJson(`${FNS_RESOURCES_BASE}/consulta-detalhada/entidades?${params}`)
    const body = isFnsConsultationResponse(upstreamBody)
      ? upstreamBody
      : isRecord(upstreamBody) ? upstreamBody.resultado : null
    if (!isFnsConsultationResponse(body)) {
      throw new ApiError(502, 'FNS_INVALID_RESPONSE', 'O portal FNS retornou uma resposta de consulta em formato inesperado.')
    }
    return context.json(body)
  })
  app.get('/api/fns/detalhe-acao', async (context) => {
    const incoming = context.req.query()
    const cpfCnpj = incoming.cpfCnpjUg?.trim() ?? ''
    if (!cpfCnpj) throw new ApiError(400, 'INVALID_DOCUMENT', 'Informe o CPF/CNPJ da entidade para consultar os dados financeiros.')
    const partnerMunicipality = requirePartnerMunicipality(incoming.estado, incoming.municipio)
    const year = incoming.ano ?? ''
    const month = incoming.mes ?? ''
    const consultationType = incoming.tipoConsulta ?? ''
    const page = incoming.page ?? '1'
    const count = incoming.count ?? '10'
    if (year && !/^\d{4}$/.test(year)) throw new ApiError(400, 'INVALID_YEAR', 'O ano deve conter quatro dígitos.')
    if (month && (!/^\d{1,2}$/.test(month) || Number(month) < 1 || Number(month) > 12)) {
      throw new ApiError(400, 'INVALID_MONTH', 'Informe um mês válido entre 1 e 12.')
    }
    if (consultationType && !/^\d+$/.test(consultationType)) {
      throw new ApiError(400, 'INVALID_CONSULTATION_TYPE', 'Informe um tipo de consulta válido.')
    }
    if (!/^[1-9]\d*$/.test(page)) throw new ApiError(400, 'INVALID_PAGE', 'A página deve ser um inteiro positivo.')
    if (!/^[1-9]\d*$/.test(count) || Number(count) > 100) {
      throw new ApiError(400, 'INVALID_COUNT', 'A quantidade por página deve estar entre 1 e 100.')
    }

    const params = new URLSearchParams()
    const filters = [
      ['ano', year],
      ['count', count],
      ['cpfCnpjUg', cpfCnpj],
      ['estado', partnerMunicipality.uf],
      ['mes', month],
      ['municipio', fnsMunicipalityCode(partnerMunicipality.ibgeCode)],
      ['page', page],
      ['tipoConsulta', consultationType],
    ] as const
    for (const [key, value] of filters) {
      if (value.trim()) params.set(key, value.trim())
    }
    const upstreamBody = await fetchJson(`${FNS_RESOURCES_BASE}/consulta-detalhada/detalhe-acao?${params}`)
    const body = isFnsFinancialResponse(upstreamBody)
      ? upstreamBody
      : isRecord(upstreamBody) ? upstreamBody.resultado : null
    if (!isFnsFinancialResponse(body)) {
      throw new ApiError(502, 'FNS_INVALID_RESPONSE', 'O portal FNS retornou dados financeiros em formato inesperado.')
    }
    return context.json(body)
  })
  app.get('/api/fns/ufs', async (context) => context.json(await getResource('/ufs', isUf)))
  app.get('/api/fns/meses', async (context) => context.json(await getResource('/meses', isMes)))
  app.get('/api/fns/municipios', (context) => context.json({
    resultado: getActivePartnerMunicipalities().map((municipality) => ({
      coMunicipioIbge: municipality.ibgeCode,
      noMunicipio: municipality.name,
      sgUf: municipality.uf,
      id: municipality.ibgeCode,
    })),
  }))
  app.get('/api/fns/municipios/:uf', async (context) => {
    const uf = context.req.param('uf').toUpperCase()
    if (!partnerStates.some((item) => item.uf === uf)) throw new ApiError(400, 'INVALID_UF', 'Informe uma UF com municípios parceiros ativos.')
    return context.json({
      resultado: getActivePartnerMunicipalities(uf).map((municipality) => ({
        coMunicipioIbge: municipality.ibgeCode,
        noMunicipio: municipality.name,
        sgUf: municipality.uf,
        id: municipality.ibgeCode,
      })),
    })
  })
  app.get('/api/fns/dirigente/:codigoIbge', async (context) => {
    const municipality = getActivePartnerMunicipality(context.req.param('codigoIbge'))
    if (!municipality) {
      throw new ApiError(403, 'MUNICIPALITY_NOT_AUTHORIZED', 'O município informado não está autorizado para consultar dirigentes.')
    }
    const upstream = await cached(
      `dirigente:${municipality.ibgeCode}`,
      () => fetchJson(`${FNS_RESOURCES_BASE}/dirigente/MUNICIPAL/${fnsMunicipalityCode(municipality.ibgeCode)}`),
    )
    return context.json(normalizeFnsMunicipalLeadership(upstream))
  })
  app.get('/api/fns/blocos', async (context) => {
    const year = context.req.query('ano') ?? ''
    const consultationType = context.req.query('coTipoConsulta') ?? ''
    if (!/^\d{4}$/.test(year)) throw new ApiError(400, 'INVALID_YEAR', 'O ano deve conter quatro dígitos.')
    if (!/^\d+$/.test(consultationType) || Number(consultationType) < 1) {
      throw new ApiError(400, 'INVALID_CONSULTATION_TYPE', 'Informe um tipo de consulta válido.')
    }
    const result = await cached(`blocos:${year}:${consultationType}`, () => getResource(
      `/blocos?ano=${year}&coTipoConsulta=${consultationType}`,
      isBloco,
    ))
    return context.json(result)
  })

  app.notFound((context) => context.json({
    error: { code: 'NOT_FOUND', message: 'Rota da API não encontrada.' },
  }, 404))

  app.onError((error, context) => {
    if (error instanceof ApiError) {
      logger.error(JSON.stringify({ method: context.req.method, path: context.req.path, code: error.code }))
      return context.json({ error: { code: error.code, message: error.message, retryable: error.retryable } }, error.status as ContentfulStatusCode)
    }
    logger.error(JSON.stringify({ method: context.req.method, path: context.req.path, code: 'INTERNAL_ERROR' }))
    return context.json({ error: { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro interno.' } }, 500)
  })

  return app
}