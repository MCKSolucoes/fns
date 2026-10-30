import type { FnsFinancialAction } from '../types/fnsFinancial'

const monetaryLabels: Record<string, string> = {
  valorTotal: 'Valor total',
  valorDescontoTotal: 'Valor total de descontos',
  valorLiquido: 'Valor líquido',
}

export interface FnsFinancialActionDetail {
  key: string
  label: string
  value: unknown
  isFinancial: boolean
}

function nestedField(value: unknown, property: 'nome' | 'id'): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>)[property]
}

export function getFnsFinancialActionDetails(action: FnsFinancialAction): FnsFinancialActionDetail[] {
  return [
    { key: 'descricao', label: 'Descrição da ação', value: action.descricao, isFinancial: false },
    { key: 'formaRepasse', label: 'Forma de repasse', value: action.formaRepasse, isFinancial: false },
    { key: 'quantidadeParcelas', label: 'Quantidade de parcelas', value: action.quantidadeParcelas, isFinancial: false },
    { key: 'componenteBlocoNome', label: 'Componente do bloco', value: nestedField(action.componenteBloco, 'nome'), isFinancial: false },
    { key: 'componenteBlocoId', label: 'ID do componente do bloco', value: nestedField(action.componenteBloco, 'id'), isFinancial: false },
    { key: 'blocoPactoNome', label: 'Bloco de pacto', value: nestedField(action.blocoPacto, 'nome'), isFinancial: false },
    { key: 'blocoPactoId', label: 'ID do bloco de pacto', value: nestedField(action.blocoPacto, 'id'), isFinancial: false },
    { key: 'grupoAcaoNome', label: 'Grupo da ação', value: nestedField(action.grupoAcao, 'nome'), isFinancial: false },
    { key: 'grupoAcaoId', label: 'ID do grupo da ação', value: nestedField(action.grupoAcao, 'id'), isFinancial: false },
    { key: 'id', label: 'ID da ação', value: action.id, isFinancial: false },
    { key: 'nomeResumido', label: 'Nome resumido', value: action.nomeResumido, isFinancial: false },
    { key: 'sigla', label: 'Sigla', value: action.sigla, isFinancial: false },
    ...Object.entries(monetaryLabels).map(([key, label]) => ({
      key,
      label,
      value: action[key],
      isFinancial: true,
    })),
  ]
}

export function formatFnsFinancialActionDetail(value: unknown, isFinancial: boolean): string {
  if (value === null || value === undefined || value === '') return '—'
  if (isFinancial && typeof value === 'number' && Number.isFinite(value)) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
  }
  if (isFinancial && typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
  }
  if (typeof value === 'object') return '—'
  return String(value)
}
