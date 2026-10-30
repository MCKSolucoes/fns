import type { FnsMunicipalLeadership, FnsMunicipalLeadershipResponse } from '../types/fnsLeadership'
import { FnsResourceError } from './fnsResourcesService'
import { getStoredAccessToken } from './authClient'

const API_BASE = '/api/fns'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLeadership(value: unknown): value is FnsMunicipalLeadership {
  if (!isRecord(value)) return false
  return (
    (value.nome === undefined || value.nome === null || typeof value.nome === 'string')
    && (value.cargo === undefined || value.cargo === null || typeof value.cargo === 'string')
    && (value.inicioMandato === undefined || value.inicioMandato === null || (typeof value.inicioMandato === 'number' && Number.isFinite(value.inicioMandato)))
    && (value.inicioMandatoFormatado === undefined || value.inicioMandatoFormatado === null || typeof value.inicioMandatoFormatado === 'string')
    && (value.noSecretario === undefined || value.noSecretario === null || typeof value.noSecretario === 'string')
    && (value.noPresidenteConselho === undefined || value.noPresidenteConselho === null || typeof value.noPresidenteConselho === 'string')
  )
}

export async function getFnsMunicipalLeadership(
  ibgeCode: string,
  signal?: AbortSignal,
): Promise<FnsMunicipalLeadershipResponse> {
  if (!/^\d{7}$/.test(ibgeCode)) {
    throw new FnsResourceError('O município selecionado não possui um código IBGE válido.')
  }

  let response: Response
  try {
    const token = getStoredAccessToken()
    response = await fetch(`${API_BASE}/dirigente/${encodeURIComponent(ibgeCode)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'omit',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    if (error instanceof TypeError) {
      throw new FnsResourceError('Não foi possível conectar à API local do FNS. Verifique se o backend está em execução.', true)
    }
    throw error
  }

  let body: unknown
  try {
    body = await response.json() as unknown
  } catch {
    if (!response.ok) throw new FnsResourceError(`A API FNS respondeu com HTTP ${response.status}.`, [502, 503, 504].includes(response.status))
    throw new FnsResourceError('A API FNS retornou dados dos responsáveis em formato inválido.')
  }

  if (!response.ok) {
    const errorBody = isRecord(body) && isRecord(body.error) ? body.error : null
    const message = typeof errorBody?.message === 'string'
      ? errorBody.message
      : response.status === 502
        ? 'O portal FNS está temporariamente indisponível (HTTP 502).'
        : response.status === 503
          ? 'O portal FNS está temporariamente indisponível (HTTP 503).'
          : `A API FNS respondeu com HTTP ${response.status}.`
    const retryable = typeof errorBody?.retryable === 'boolean'
      ? errorBody.retryable
      : [502, 503, 504].includes(response.status)
    throw new FnsResourceError(message, retryable)
  }

  if (!isRecord(body) || !Object.hasOwn(body, 'resultado')) {
    throw new FnsResourceError('O portal FNS retornou dados dos responsáveis em formato inesperado.')
  }
  if (body.resultado === null) return { resultado: null }
  if (!isLeadership(body.resultado)) {
    throw new FnsResourceError('O portal FNS retornou dados dos responsáveis em formato inesperado.')
  }
  const source = body.resultado
  const leadership: FnsMunicipalLeadership = {
    ...(typeof source.nome === 'string' ? { nome: source.nome } : {}),
    ...(typeof source.cargo === 'string' ? { cargo: source.cargo } : {}),
    ...(typeof source.inicioMandato === 'number' && Number.isFinite(source.inicioMandato) ? { inicioMandato: source.inicioMandato } : {}),
    ...(typeof source.inicioMandatoFormatado === 'string' ? { inicioMandatoFormatado: source.inicioMandatoFormatado } : {}),
    ...(typeof source.noSecretario === 'string' ? { noSecretario: source.noSecretario } : {}),
    ...(typeof source.noPresidenteConselho === 'string' ? { noPresidenteConselho: source.noPresidenteConselho } : {}),
  }
  const hasValues = Object.values(leadership).some((value) => value !== '')
  return { resultado: hasValues ? leadership : null }
}
