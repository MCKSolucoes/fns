import type { MesOption } from '../types/fnsResources'

export function formatConsultationMonth(value: string, options: readonly MesOption[]): string {
  if (!value) return 'Todos'
  if (!/^\d{1,2}$/.test(value)) return '—'

  const month = Number(value)
  if (month < 1 || month > 12) return '—'

  const apiLabel = options.find((option) => option.valor === month)?.descricao.trim()
  const label = apiLabel || new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, month - 1, 1)))
  const readableLabel = `${label[0].toLocaleUpperCase('pt-BR')}${label.slice(1)}`
  return `${readableLabel} (${month})`
}
