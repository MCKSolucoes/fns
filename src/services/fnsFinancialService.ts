import type { FnsBlockTotal, FnsFinancialAction, FnsFinancialFilters, FnsFinancialResponse } from '../types/fnsFinancial'
import { FnsResourceError } from './fnsResourcesService'
import { getStoredAccessToken } from './authClient'

const API_BASE = '/api/fns'
const FINANCIAL_CACHE_TTL_MS = 5 * 60 * 1000
const FINANCIAL_CACHE_MAX_ENTRIES = 50
interface FinancialPageCacheEntry {
  response: FnsFinancialResponse
  expiresAt: number
  contextKey: string
  page: number
  sourceTotal: number
  invalidCount: number
}

interface FinancialPageContext {
  entriesByPage: Map<number, { sourceTotal: number; invalidCount: number }>
}

interface FinancialSourceMetadata {
  total: number
  totalPages: number
  invalidCount: number
}

const financialResponseCache = new Map<string, FinancialPageCacheEntry>()
const pendingFinancialRequests = new Map<string, Promise<FnsFinancialResponse>>()
const financialPageContexts = new Map<string, FinancialPageContext>()
const financialSourceMetadata = new WeakMap<FnsFinancialResponse, FinancialSourceMetadata>()

export interface FnsFinancialAggregateSummary {
  key: string
  totals: ReturnType<typeof getFinancialGeneralTotals>
  blocks: FnsBlockTotal[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numeric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value)
  return undefined
}

export function getFinancialBlockSummary(actions: FnsFinancialAction[]): FnsBlockTotal[] {
  for (const action of actions) {
    if (!Array.isArray(action.totalBloco)) continue
    const blocks = action.totalBloco.filter((item): item is FnsBlockTotal => isRecord(item))
    if (blocks.length > 0) return blocks
  }
  return []
}

export function getFinancialGeneralTotals(actions: FnsFinancialAction[]) {
  const totalFields = ['valorTotalGeral', 'valorDescontoTotalGeral', 'valorLiquidoGeral'] as const
  const totals = Object.fromEntries(totalFields.map((field) => [
    field,
    actions.find((action) => action[field] !== undefined && action[field] !== null)?.[field],
  ]))
  return {
    total: numeric(totals.valorTotalGeral),
    discounts: numeric(totals.valorDescontoTotalGeral),
    net: numeric(totals.valorLiquidoGeral),
  }
}

export function mergeFnsFinancialAggregates(
  current: FnsFinancialAggregateSummary | null,
  key: string,
  actions: FnsFinancialAction[],
): FnsFinancialAggregateSummary {
  const previous = current?.key === key ? current : null
  const latest = getFinancialGeneralTotals(actions)
  const latestBlocks = getFinancialBlockSummary(actions)
  return {
    key,
    totals: {
      total: latest.total ?? previous?.totals.total,
      discounts: latest.discounts ?? previous?.totals.discounts,
      net: latest.net ?? previous?.totals.net,
    },
    blocks: latestBlocks.length ? latestBlocks : previous?.blocks ?? [],
  }
}

export function isFnsFinancialResponse(value: unknown): value is FnsFinancialResponse {
  return isRecord(value)
    && Array.isArray(value.dados)
    && value.dados.every(isRecord)
    && ['pagina', 'itensPorPagina', 'total', 'totalPaginas'].every((key) =>
      Number.isInteger(value[key]) && Number(value[key]) >= 0,
    )
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasValidActionId(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  if (typeof value === 'string') return value.trim() !== '' && value.trim() !== '0'
  return false
}

function hasNestedComponent(value: unknown): boolean {
  if (!isRecord(value)) return false
  return hasText(value.nome)
    || hasText(value.descricao)
    || hasValidActionId(value.id)
}

function hasNonZeroFinancialValue(action: FnsFinancialAction): boolean {
  return ['valorTotal', 'valorDescontoTotal', 'valorLiquido'].some((field) => {
    const value = action[field]
    if (typeof value === 'number') return Number.isFinite(value) && value !== 0
    return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) !== 0
  })
}

export function isRelevantFnsFinancialAction(action: FnsFinancialAction): boolean {
  return hasValidActionId(action.id)
    || hasText(action.descricao)
    || hasText(action.nomeResumido)
    || hasText(action.sigla)
    || hasText(action.formaRepasse)
    || hasText(action.quantidadeParcelas)
    || hasNestedComponent(action.componenteBloco)
    || hasNonZeroFinancialValue(action)
}

export function filterFnsFinancialActions(actions: FnsFinancialAction[]): FnsFinancialAction[] {
  return actions.filter(isRelevantFnsFinancialAction)
}

function getFinancialPageContextKey(params: URLSearchParams): string {
  return new URLSearchParams([...params.entries()]
    .filter(([key]) => key !== 'page')
    .sort(([left], [right]) => left.localeCompare(right)))
    .toString()
}

function applyFilteredPagination(
  response: FnsFinancialResponse,
  contextKey: string,
  page: number,
  sourceTotal: number,
  invalidCount: number,
): void {
  const count = response.itensPorPagina
  const context = financialPageContexts.get(contextKey) ?? { entriesByPage: new Map() }
  context.entriesByPage.set(page, { sourceTotal, invalidCount })
  financialPageContexts.set(contextKey, context)

  const invalidRows = [...context.entriesByPage.values()].reduce((total, entry) => total + entry.invalidCount, 0)
  const filteredTotal = Math.max(0, sourceTotal - invalidRows)
  const filteredPages = filteredTotal === 0 ? 0 : Math.ceil(filteredTotal / count)

  for (const entry of financialResponseCache.values()) {
    if (entry.contextKey !== contextKey) continue
    entry.response.total = Math.min(entry.sourceTotal, filteredTotal)
    entry.response.totalPaginas = entry.response.total === 0 ? 0 : Math.ceil(entry.response.total / count)
  }

  response.total = filteredTotal
  response.totalPaginas = filteredPages
}

function getFinancialSourceMetadata(response: FnsFinancialResponse): FinancialSourceMetadata {
  return financialSourceMetadata.get(response) ?? {
    total: response.total,
    totalPages: response.totalPaginas,
    invalidCount: 0,
  }
}

function createFinancialParams(filters: FnsFinancialFilters): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === 'string' ? value.trim() : value !== undefined) params.set(key, String(value).trim())
  }
  return new URLSearchParams([...params.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

function waitForRequest<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request
  if (signal.aborted) return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    request.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function removeFinancialCacheEntry(key: string): void {
  const cached = financialResponseCache.get(key)
  if (!cached) return
  financialResponseCache.delete(key)
  const context = financialPageContexts.get(cached.contextKey)
  context?.entriesByPage.delete(cached.page)
  if (context?.entriesByPage.size === 0) financialPageContexts.delete(cached.contextKey)
}

function pruneExpiredFinancialCacheEntries(): void {
  const now = Date.now()
  for (const [key, cached] of financialResponseCache) {
    if (cached.expiresAt <= now) removeFinancialCacheEntry(key)
  }
}

function cacheFinancialResponse(key: string, entry: FinancialPageCacheEntry): void {
  pruneExpiredFinancialCacheEntries()
  financialResponseCache.delete(key)
  financialResponseCache.set(key, entry)
  while (financialResponseCache.size > FINANCIAL_CACHE_MAX_ENTRIES) {
    const oldestKey = financialResponseCache.keys().next().value
    if (oldestKey === undefined) break
    removeFinancialCacheEntry(oldestKey)
  }
}

export function clearFnsFinancialPageCache(): void {
  financialResponseCache.clear()
  financialPageContexts.clear()
}

async function fetchFnsFinancialPage(params: URLSearchParams): Promise<FnsFinancialResponse> {
  let response: Response
  try {
    const token = getStoredAccessToken()
    response = await fetch(`${API_BASE}/detalhe-acao?${params}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'omit',
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new FnsResourceError('Não foi possível conectar à API local do FNS. Verifique se o backend está em execução.', true)
    }
    throw error
  }

  let body: unknown
  try {
    body = await response.json() as unknown
  } catch {
    if (!response.ok) {
      throw new FnsResourceError(`A API FNS respondeu com HTTP ${response.status}.`, [502, 503, 504].includes(response.status))
    }
    throw new FnsResourceError('A API FNS retornou uma resposta financeira que não é JSON válido.')
  }
  if (!response.ok) {
    const errorBody = isRecord(body) && isRecord(body.error) ? body.error : null
    const message = typeof errorBody?.message === 'string'
      ? errorBody.message
      : response.status === 502
        ? 'O portal FNS está temporariamente indisponível (HTTP 502).'
        : response.status === 503
          ? 'O portal FNS está temporariamente indisponível (HTTP 503).'
          : response.status === 504
            ? 'A consulta financeira ao portal FNS excedeu o tempo limite (timeout).'
            : `A API FNS respondeu com HTTP ${response.status}.`
    const retryable = typeof errorBody?.retryable === 'boolean'
      ? errorBody.retryable
      : [502, 503, 504].includes(response.status)
    throw new FnsResourceError(message, retryable)
  }
  if (!isFnsFinancialResponse(body)) {
    throw new FnsResourceError('A consulta financeira do FNS retornou dados em formato inválido.')
  }
  const actions = filterFnsFinancialActions(body.dados)
  const normalized: FnsFinancialResponse = { ...body, dados: actions }
  const page = Number(params.get('page') ?? body.pagina)
  const sourceTotal = body.total
  const sourceTotalPages = body.totalPaginas
  const contextKey = getFinancialPageContextKey(params)
  const invalidCount = body.dados.length - actions.length
  financialSourceMetadata.set(normalized, { total: sourceTotal, totalPages: sourceTotalPages, invalidCount })
  applyFilteredPagination(normalized, contextKey, page, sourceTotal, invalidCount)
  return normalized
}

export function getFnsFinancialPage(filters: FnsFinancialFilters, signal?: AbortSignal): Promise<FnsFinancialResponse> {
  pruneExpiredFinancialCacheEntries()
  const params = createFinancialParams(filters)
  const key = params.toString()
  if (signal?.aborted) return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))

  const cached = financialResponseCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    financialResponseCache.delete(key)
    financialResponseCache.set(key, cached)
    applyFilteredPagination(
      cached.response,
      cached.contextKey,
      cached.page,
      cached.sourceTotal,
      cached.invalidCount,
    )
    return waitForRequest(Promise.resolve(cached.response), signal)
  }
  if (cached) removeFinancialCacheEntry(key)

  let request = pendingFinancialRequests.get(key)
  if (!request) {
    // Shared requests outlive one caller's abort so remaining callers can still use them.
    request = fetchFnsFinancialPage(params).then((result) => {
      const source = getFinancialSourceMetadata(result)
      const entry: FinancialPageCacheEntry = {
        response: result,
        expiresAt: Date.now() + FINANCIAL_CACHE_TTL_MS,
        contextKey: getFinancialPageContextKey(params),
        page: Number(params.get('page') ?? result.pagina),
        sourceTotal: source.total,
        invalidCount: source.invalidCount,
      }
      cacheFinancialResponse(key, entry)
      return result
    })
    pendingFinancialRequests.set(key, request)
    request.then(
      () => { if (pendingFinancialRequests.get(key) === request) pendingFinancialRequests.delete(key) },
      () => { if (pendingFinancialRequests.get(key) === request) pendingFinancialRequests.delete(key) },
    )
  }
  return waitForRequest(request, signal)
}

export async function getAllFnsFinancialPages(
  filters: Omit<FnsFinancialFilters, 'page' | 'count'>,
  signal: AbortSignal,
  onProgress: (loadedPages: number, totalPages: number) => void,
): Promise<FnsFinancialResponse> {
  const count = 100
  const first = await getFnsFinancialPage({ ...filters, page: 1, count }, signal)
  if (first.pagina !== 1) {
    throw new FnsResourceError('O FNS retornou uma página financeira diferente da solicitada. Nenhum arquivo foi gerado.')
  }
  const source = getFinancialSourceMetadata(first)
  const pages = source.totalPages
  const records = [...first.dados]
  onProgress(1, pages)
  for (let page = 2; page <= pages; page += 1) {
    const result = await getFnsFinancialPage({ ...filters, page, count }, signal)
    const pageSource = getFinancialSourceMetadata(result)
    if (result.pagina !== page || pageSource.total !== source.total || pageSource.totalPages !== pages) {
      throw new FnsResourceError('A paginação dos dados financeiros mudou durante a exportação. Nenhum arquivo foi gerado.')
    }
    records.push(...result.dados)
    onProgress(page, pages)
  }
  if (records.length !== first.total) {
    throw new FnsResourceError(`A exportação recebeu ${records.length} de ${first.total} ações. Nenhum arquivo foi gerado.`)
  }
  return { ...first, dados: records, itensPorPagina: records.length }
}
