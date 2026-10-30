export interface FnsFinancialAction {
  id?: unknown
  descricao?: unknown
  sigla?: unknown
  nomeResumido?: unknown
  formaRepasse?: unknown
  quantidadeParcelas?: unknown
  componenteBloco?: unknown
  blocoPacto?: unknown
  grupoAcao?: unknown
  valorTotal?: unknown
  valorDescontoTotal?: unknown
  valorLiquido?: unknown
  valorTotalGeral?: unknown
  valorDescontoTotalGeral?: unknown
  valorLiquidoGeral?: unknown
  totalBloco?: unknown
  [key: string]: unknown
}

export interface FnsFinancialResponse {
  dados: FnsFinancialAction[]
  pagina: number
  itensPorPagina: number
  total: number
  totalPaginas: number
}

export interface FnsFinancialFilters {
  ano?: string
  count: number
  cpfCnpjUg: string
  estado?: string
  mes?: string
  municipio?: string
  page: number
  tipoConsulta?: string
}

export interface FnsFinancialEntity {
  uf?: unknown
  municipio?: unknown
  cpfCnpj?: unknown
  cpfCnpjFormatado?: unknown
  razaoSocial?: unknown
  codigoMunicipioIBGE?: unknown
}

export type FnsFinancialReviewStatus =
  | ''
  | 'Não iniciada'
  | 'Em conferência'
  | 'Conferida'
  | 'Pendente de esclarecimento'

export interface FnsFinancialComplement {
  observations: string
  reviewStatus: FnsFinancialReviewStatus
  reviewResponsible: string
  internalReference: string
}

export interface SavedFnsFinancialComplement extends FnsFinancialComplement {
  updatedAt: string
}

export type FnsFinancialLaunchStatus = 'Pendente' | 'Em análise' | 'Conferido' | 'Lançado'

export interface FnsFinancialLaunchDraft {
  status: FnsFinancialLaunchStatus
  amount: string
  date: string
  documentNumber: string
  accountReference: string
  responsible: string
  observations: string
}

export interface FnsFinancialLaunch extends FnsFinancialLaunchDraft {
  actionKey: string
  repasseId?: string
  createdAt: string
  updatedAt: string
}

export interface FnsBlockTotal {
  id?: unknown
  nome?: unknown
  grupo?: unknown
  valorTotal?: unknown
  valorDescontoTotal?: unknown
  valorLiquido?: unknown
  [key: string]: unknown
}
