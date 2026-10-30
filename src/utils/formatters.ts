import type { Baixa, Repasse } from '../types'

export const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0)
export const formatCurrencyInput = (value: string) => {
	const cents = Number(value.replace(/\D/g, ''))
	return formatCurrency(Number.isFinite(cents) ? cents / 100 : 0)
}
export const parseCurrencyInput = (value: string) => {
	const cents = Number(value.replace(/\D/g, ''))
	return Number.isFinite(cents) ? cents / 100 : 0
}
export const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : '—'
export const formatDateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
export const monthName = (month: number, short = false) => new Intl.DateTimeFormat('pt-BR', { month: short ? 'short' : 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month - 1, 1)))
export const repasseLabel = (transfer: Repasse) => `${transfer.month > 0 ? String(transfer.month).padStart(2, '0') : '—'}/${transfer.year} · ${transfer.processNumber}`
export const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
export const baixaForTransfer = (transfer: Repasse, baixas: Baixa[]) => baixas.find((baixa) => baixa.repasseId === transfer.storageId || (!baixa.repasseId && baixa.transferId === transfer.id))
export const transferBalance = (transfer: Repasse, baixa?: Baixa) => Math.max(transfer.netAmount - (baixa?.paidAmount ?? 0), 0)
