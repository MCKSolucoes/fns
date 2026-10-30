import type { TipoConsultaOption } from '../types/fnsResources.js'

export const DEFAULT_CONSULTATION_TYPE = '2'

export function getDefaultConsultationType(options: TipoConsultaOption[]): string {
  return options.some((option) => String(option.valor) === DEFAULT_CONSULTATION_TYPE)
    ? DEFAULT_CONSULTATION_TYPE
    : ''
}
