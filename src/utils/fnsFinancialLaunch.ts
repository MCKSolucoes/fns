import type { FnsFinancialLaunchDraft } from '../types/fnsFinancial'

export function emptyFnsFinancialLaunchDraft(amount = ''): FnsFinancialLaunchDraft {
  return {
    status: 'Pendente',
    amount,
    date: getLocalFnsFinancialLaunchDate(),
    documentNumber: '',
    accountReference: '',
    responsible: '',
    observations: '',
  }
}

export function getLocalFnsFinancialLaunchDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getFnsFinancialLaunchDate(savedDate: string): string {
  return savedDate || getLocalFnsFinancialLaunchDate()
}

export function parseFnsFinancialLaunchAmount(value: string): number | undefined {
  const normalized = value.trim()
  if (/^\d+(?:,\d{0,2})?$/.test(normalized)) return Number(normalized.replace(',', '.'))
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{0,2})?$/.test(normalized)) {
    return Number(normalized.replaceAll('.', '').replace(',', '.'))
  }
  if (/^\d+(?:\.\d{1,2})?$/.test(normalized)) return Number(normalized)
  return undefined
}

export function isValidFnsFinancialLaunchDate(value: string): boolean {
  if (!value) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function formatFnsFinancialLaunchAmount(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}
