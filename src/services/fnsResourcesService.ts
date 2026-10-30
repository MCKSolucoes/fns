import type { AnoOption, BlocoOption, MesOption, MunicipioOption, RepasseOption, TipoConsultaOption, UfOption } from '../types/fnsResources'
import type { FnsConsultationFilters, FnsConsultationResponse } from '../types/fnsConsultation'
import { getStoredAccessToken } from './authClient'

const API_BASE = '/api/fns'
const responseCache = new Map<string, { promise: Promise<unknown[]>; value?: unknown[] }>()

interface FnsErrorResponse {
  error?: {
    message?: unknown
    retryable?: unknown
  }
}

export class FnsResourceError extends Error {
  readonly retryable: boolean
  readonly cachedItems?: unknown[]

  constructor(message: string, retryable = false, cachedItems?: unknown[]) {
    super(message)
    this.name = 'FnsResourceError'
    this.retryable = retryable
    this.cachedItems = cachedItems
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
  return isRecord(value) && typeof value.coUfIbge === 'string' && typeof value.sigla === 'string' && typeof value.nome === 'string' && typeof value.registroAtivo === 'string' && typeof value.id === 'string'
}

function isMes(value: unknown): value is MesOption {
  return isRecord(value) && typeof value.descricao === 'string' && typeof value.valor === 'number'
}

function isMunicipio(value: unknown): value is MunicipioOption {
  return isRecord(value)
    && typeof value.coMunicipioIbge === 'string'
    && typeof value.noMunicipio === 'string'
    && typeof value.sgUf === 'string'
    && typeof value.id === 'string'
}

function isBloco(value: unknown): value is BlocoOption {
  return isRecord(value) && typeof value.id === 'string' && typeof value.nome === 'string'
}

function isFnsConsultationResponse(value: unknown): value is FnsConsultationResponse {
  return isRecord(value)
    && Array.isArray(value.dados)
    && value.dados.every(isRecord)
    && ['pagina', 'itensPorPagina', 'total', 'totalPaginas'].every((key) =>
      Number.isInteger(value[key]) && Number(value[key]) >= 0,
    )
}

async function fetchResultado<T>(url: string, isItem: (item: unknown) => item is T): Promise<T[]> {
  const token = getStoredAccessToken()
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'omit',
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new FnsResourceError('Não foi possível conectar ao backend FNS. Verifique se o servidor está em execução (npm run dev:server).', true)
    }
    throw error
  }

  if (!response.ok) {
    let body: FnsErrorResponse | null = null
    try {
      body = await response.json() as FnsErrorResponse
    } catch {
      body = null
    }
    const contentType = response.headers.get('content-type') ?? ''
    const isHtml = contentType.includes('text/html')
    const message = typeof body?.error?.message === 'string'
      ? body.error.message
      : response.status === 502 && isHtml
        ? 'O servidor backend FNS (porta 3001) não está em execução. Certifique-se de que o backend foi iniciado (npm run dev:server).'
        : response.status === 502
          ? 'O portal FNS está temporariamente indisponível (HTTP 502).'
          : response.status === 503
            ? 'O portal FNS está temporariamente indisponível (HTTP 503).'
            : response.status === 504
              ? 'A consulta ao portal FNS excedeu o tempo limite (timeout).'
              : `A API FNS respondeu com HTTP ${response.status}.`
    const retryable = typeof body?.error?.retryable === 'boolean'
      ? body.error.retryable
      : [502, 503, 504].includes(response.status)
    throw new FnsResourceError(message, retryable)
  }

  let body: unknown
  try {
    body = await response.json() as unknown
  } catch {
    throw new FnsResourceError('A API FNS retornou uma resposta que não é JSON válido.')
  }
  if (!isRecord(body) || !Array.isArray(body.resultado)) {
    throw new FnsResourceError('A resposta da API FNS não contém uma lista em "resultado".')
  }
  return body.resultado.map((item, index) => {
    if (!isItem(item)) throw new FnsResourceError(`O item ${index + 1} da resposta da API FNS tem formato inválido.`)
    return item
  })
}

async function getResultado<T>(url: string, isItem: (item: unknown) => item is T, refresh = false): Promise<T[]> {
  const existing = responseCache.get(url)
  if (existing && !refresh) return existing.promise as Promise<T[]>

  const entry: { promise: Promise<unknown[]>; value?: unknown[] } = {
    promise: Promise.resolve([]),
    ...(existing?.value ? { value: existing.value } : {}),
  }
  const request = fetchResultado(url, isItem)
  entry.promise = request
  responseCache.set(url, entry)
  request.then(
    (items) => { entry.value = items },
    () => {
      if (responseCache.get(url) !== entry) return
      if (existing?.value) responseCache.set(url, existing)
      else responseCache.delete(url)
    },
  )
  try {
    return await request
  } catch (error) {
    if (existing?.value && error instanceof FnsResourceError) {
      throw new FnsResourceError(error.message, error.retryable, existing.value)
    }
    throw error
  }
}

export const fnsResourcesService = {
  async getConsultas(filters: FnsConsultationFilters, page: number, count: number, signal?: AbortSignal): Promise<FnsConsultationResponse> {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) {
      if (value?.trim()) params.set(key, value.trim())
    }
    params.set('page', String(page))
    params.set('count', String(count))
    const token = getStoredAccessToken()
    let response: Response
    try {
      response = await fetch(`${API_BASE}/consultas?${params}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'omit',
        signal,
      })
    } catch (error) {
      if (error instanceof TypeError) {
        throw new FnsResourceError('Não foi possível conectar à API local do FNS. Verifique se o backend está em execução (npm run dev:server).', true)
      }
      throw error
    }

    let body: unknown
    try {
      body = await response.json() as unknown
    } catch {
      if (!response.ok) {
        const isHtml = (response.headers.get('content-type') ?? '').includes('text/html')
        if (response.status === 502 && isHtml) {
          throw new FnsResourceError('O servidor backend FNS (porta 3001) não está em execução. Certifique-se de que o backend foi iniciado (npm run dev:server).', true)
        }
        throw new FnsResourceError(`A API FNS respondeu com HTTP ${response.status}.`, [502, 503, 504].includes(response.status))
      }
      throw new FnsResourceError('A API FNS retornou uma resposta que não é JSON válido.')
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
              ? 'A consulta ao portal FNS excedeu o tempo limite (timeout).'
              : `A API FNS respondeu com HTTP ${response.status}.`
      const retryable = typeof errorBody?.retryable === 'boolean'
        ? errorBody.retryable
        : [502, 503, 504].includes(response.status)
      throw new FnsResourceError(message, retryable)
    }
    if (!isFnsConsultationResponse(body)) {
      throw new FnsResourceError('A consulta do portal FNS retornou dados em formato inválido.')
    }
    return body
  },

  async getAnos(refresh = false): Promise<AnoOption[]> {
    const items = await getResultado(`${API_BASE}/anos`, isAno, refresh)
    return [...items].sort((a, b) => Number(b.valor) - Number(a.valor))
  },

  getTiposConsulta(ano: string, refresh = false): Promise<TipoConsultaOption[]> {
    return getResultado(`${API_BASE}/tipos-consulta/${encodeURIComponent(ano)}`, isTipoConsulta, refresh)
  },

  getRepasses(refresh = false): Promise<RepasseOption[]> {
    return getResultado(`${API_BASE}/repasses`, isRepasse, refresh)
  },

  getUfs(refresh = false): Promise<UfOption[]> {
    return getResultado(`${API_BASE}/ufs`, isUf, refresh)
  },

  getMunicipios(refresh = false): Promise<MunicipioOption[]> {
    return getResultado(`${API_BASE}/municipios`, isMunicipio, refresh)
  },

  getBlocos(year: string, consultationType: string, refresh = false): Promise<BlocoOption[]> {
    const params = new URLSearchParams({ ano: year, coTipoConsulta: consultationType })
    return getResultado(`${API_BASE}/blocos?${params}`, isBloco, refresh)
  },

  async getMeses(refresh = false): Promise<MesOption[]> {
    const items = await getResultado(`${API_BASE}/meses`, isMes, refresh)
    return [...items].sort((a, b) => a.valor - b.valor)
  },
}
