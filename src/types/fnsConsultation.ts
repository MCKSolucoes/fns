export interface FnsConsultationEntity {
  uf?: unknown
  municipio?: unknown
  cpfCnpj?: unknown
  razaoSocial?: unknown
  codigoMunicipioIBGE?: unknown
  esferaAdministrativa?: unknown
  entidadeSemRepasse?: unknown
  cpfCnpjFormatado?: unknown
  federal?: unknown
  esferaEstadual?: unknown
  tipoDirigente?: unknown
}

export interface FnsConsultationResponse {
  dados: FnsConsultationEntity[]
  pagina: number
  itensPorPagina: number
  total: number
  totalPaginas: number
}

export interface FnsConsultationFilters {
  ano?: string
  mes?: string
  tipoConsulta?: string
  estado?: string
  municipio?: string
  blocos?: string
  grupo?: string
  cpfCnpjUg?: string
  processo?: string
  proposta?: string
  repasse?: string
  dataInicialOb?: string
  dataFinalOb?: string
  portaria?: string
}
