import type { Baixa, BaixaStatus } from '../types'

export function validateBaixa(baixa: Baixa, amountAvailable: number): string {
  if (!baixa.beneficiary.trim()) return 'Informe o nome do funcionário ou beneficiário.'
  if (!Number.isFinite(baixa.paidAmount) || baixa.paidAmount < 0) return 'Informe um valor pago válido, igual ou maior que zero.'
  if (baixa.paidAmount > amountAvailable && !baixa.description.trim()) return 'O valor pago supera o valor líquido. Informe uma justificativa.'
  if (baixa.paidAmount > 0 && ['Pendente', 'Em processamento'].includes(baixa.status)) return 'Informe o status Pago ou Pago parcialmente para registrar um valor pago.'
  if ((baixa.status === 'Pago' || baixa.status === 'Pago parcialmente') && (!baixa.paymentDate || baixa.paidAmount <= 0)) return 'Para registrar pagamento, informe a data efetiva e um valor pago maior que zero.'
  if (baixa.status === 'Pago' && baixa.paidAmount < amountAvailable) return 'O status Pago exige o valor líquido integral. Para valor menor, selecione Pago parcialmente.'
  if (baixa.status === 'Pago parcialmente' && baixa.paidAmount >= amountAvailable) return 'Para valor igual ou superior ao líquido, selecione Pago.'
  if (baixa.status === 'Cancelado' && !baixa.description.trim()) return 'Informe o motivo do cancelamento.'
  return ''
}

export const baixaStatuses: BaixaStatus[] = ['Pendente', 'Em processamento', 'Pago', 'Pago parcialmente', 'Cancelado']