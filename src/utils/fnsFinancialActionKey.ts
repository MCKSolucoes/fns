import type { FnsFinancialAction, FnsFinancialEntity } from '../types/fnsFinancial'
import type { ConsultationFilters } from '../types'

function nestedId(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ''
  const id = (value as Record<string, unknown>).id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : ''
}

export async function createFnsFinancialActionKey(
  entity: FnsFinancialEntity,
  filters: ConsultationFilters,
  action: FnsFinancialAction,
): Promise<string> {
  const identity = [
    entity.cpfCnpj ?? '',
    entity.codigoMunicipioIBGE ?? entity.municipio ?? '',
    entity.uf ?? '',
    filters.cityCode,
    filters.state,
    filters.year,
    filters.month,
    filters.queryType,
    action.id ?? '',
    action.id === undefined || action.id === null || action.id === ''
      ? [action.descricao ?? '', nestedId(action.componenteBloco), nestedId(action.blocoPacto), nestedId(action.grupoAcao)].join('|')
      : '',
  ].map((value) => String(value).trim())
  const bytes = new TextEncoder().encode(JSON.stringify(identity))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
