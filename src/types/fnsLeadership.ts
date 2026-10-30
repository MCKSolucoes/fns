export interface FnsMunicipalLeadership {
  nome?: string
  cargo?: string
  inicioMandato?: number
  inicioMandatoFormatado?: string
  noSecretario?: string
  noPresidenteConselho?: string
}

export interface FnsMunicipalLeadershipResponse {
  resultado: FnsMunicipalLeadership | null
}
