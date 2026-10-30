import { createContext } from 'react'
import type { Baixa, Deputado, EmendaEstadual, HistoricoAlteracao, Repasse } from '../types'

export interface AppDataValue {
  repasses: Repasse[]
  repassesLoading: boolean
  repassesError: string
  dataLoading: boolean
  dataError: string
  persistenceMode: 'unavailable' | 'supabase'
  baixas: Baixa[]
  history: HistoricoAlteracao[]
  emendas: EmendaEstadual[]
  deputies: Deputado[]
  saveBaixa: (baixa: Baixa, previous?: Baixa, deputadoResponsavel?: string, emendaId?: string) => Promise<void>
  deleteBaixa: (baixa: Baixa, deputadoResponsavel?: string, emendaId?: string) => Promise<void>
  saveEmenda: (emenda: EmendaEstadual) => Promise<void>
  deleteEmenda: (emenda: EmendaEstadual) => Promise<void>
  saveDeputy: (deputy: Deputado) => Promise<void>
  deleteDeputy: (deputy: Deputado) => Promise<void>
  reload: () => Promise<void>
}

export const AppDataContext = createContext<AppDataValue | null>(null)