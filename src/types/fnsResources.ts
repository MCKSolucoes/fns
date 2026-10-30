export interface FnsResourceEnvelope<T> {
  resultado: T[]
}

export interface AnoOption {
  valor: string
  descricao: string
}

export interface TipoConsultaOption {
  valor: number
  descricao: string
}

export interface RepasseOption {
  valor: number
  descricao: string
}

export interface UfOption {
  coUfIbge: string
  sigla: string
  nome: string
  registroAtivo: string
  id: string
}

export interface MesOption {
  descricao: string
  valor: number
}

export interface MunicipioOption {
  coMunicipioIbge: string
  noMunicipio: string
  sgUf: string
  id: string
  registroAtivo?: string
  stCapital?: string
}

export interface BlocoOption {
  id: string
  nome: string
}

export type AnosResponse = FnsResourceEnvelope<AnoOption>
export type TiposConsultaResponse = FnsResourceEnvelope<TipoConsultaOption>
export type RepassesResponse = FnsResourceEnvelope<RepasseOption>
export type UfsResponse = FnsResourceEnvelope<UfOption>
export type MesesResponse = FnsResourceEnvelope<MesOption>
export type MunicipiosResponse = FnsResourceEnvelope<MunicipioOption>
export type BlocosResponse = FnsResourceEnvelope<BlocoOption>