import { initialBaixas } from '../data/mockRepasses'
import type { Baixa, EmendaEstadual, EmendaSnapshot, HistoricoAlteracao, PersistedData } from '../types'
import type { FnsFinancialComplement, SavedFnsFinancialComplement } from '../types/fnsFinancial'
import type { FnsFinancialComplementRepository } from './FnsFinancialComplementRepository'

const STORAGE_KEY = 'fns-repasses-demo:v1'

function initialData(): PersistedData {
  const history = initialBaixas.slice(1, 5).map((baixa): HistoricoAlteracao => ({
    id: `inicial-${baixa.id}`,
    transferId: baixa.transferId,
    baixaId: baixa.id,
    action: 'Baixa demonstrativa registrada',
    timestamp: baixa.updatedAt,
    description: baixa.description || 'Registro inicial da demonstração.',
    newStatus: baixa.status,
    newAmount: baixa.paidAmount,
  }))
  return { version: 2, baixas: initialBaixas, history, emendas: [] }
}

export interface BaixasRepository {
  load(): PersistedData
  save(baixa: Baixa, previous?: Baixa, deputadoResponsavel?: string, emenda?: EmendaEstadual): PersistedData
  delete(baixa: Baixa, deputadoResponsavel?: string, emenda?: EmendaEstadual): PersistedData
  saveEmenda(emenda: EmendaEstadual): PersistedData
  deleteEmenda(emenda: EmendaEstadual): PersistedData
  reset(): PersistedData
}

export class LocalStorageBaixasRepository implements BaixasRepository, FnsFinancialComplementRepository {
  load(): PersistedData {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return this.write(initialData())
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Os dados locais estão em JSON inválido. O conteúdo original foi preservado; não salve novos dados até conferir ou recuperar essa chave.')
    }
    if (!isRecord(parsed) || !('version' in parsed) || !('baixas' in parsed) || !('history' in parsed)
      || !Array.isArray(parsed.baixas) || !parsed.baixas.every(isBaixa)
      || !Array.isArray(parsed.history) || !parsed.history.every(isHistory)
      || ('financialComplements' in parsed && (!isRecord(parsed.financialComplements) || !Object.values(parsed.financialComplements).every(isSavedFinancialComplement)))) {
      throw new Error('Os dados locais estão em formato inválido ou incompleto. O conteúdo original foi preservado; não salve novos dados até conferir ou recuperar essa chave.')
    }
    const financialComplements = isRecord(parsed.financialComplements)
      ? parsed.financialComplements as PersistedData['financialComplements']
      : undefined
    if (parsed.version === 1) {
      return this.write({
        version: 2,
        baixas: parsed.baixas,
        history: parsed.history,
        emendas: [],
        ...(financialComplements ? { financialComplements } : {}),
      })
    }
    if (parsed.version === 2 && Array.isArray(parsed.emendas) && parsed.emendas.every(isEmenda)) {
      return {
        version: 2,
        baixas: parsed.baixas,
        history: parsed.history,
        emendas: parsed.emendas,
        ...(financialComplements ? { financialComplements } : {}),
      }
    }
    throw new Error('A versão dos dados locais não é compatível. O conteúdo original foi preservado; atualize o aplicativo ou recupere essa chave.')
  }

  save(baixa: Baixa, previous?: Baixa, deputadoResponsavel?: string, emenda?: EmendaEstadual): PersistedData {
    const data = this.load()
    const exists = data.baixas.some((item) => item.id === baixa.id)
    const deputy = deputadoResponsavel?.trim() || baixa.deputadoResponsavel?.trim()
    const amendmentId = emenda?.id ?? baixa.emendaId
    const amendmentSnapshot = emenda ? snapshotEmenda(emenda) : baixa.emendaSnapshot
    const savedBaixa: Baixa = {
      ...baixa,
      ...(deputy ? { deputadoResponsavel: deputy } : {}),
      ...(amendmentId ? { emendaId: amendmentId } : {}),
      ...(amendmentSnapshot ? { emendaId: amendmentSnapshot.id, emendaSnapshot: amendmentSnapshot, emendaIdentificacao: `${amendmentSnapshot.uf} · ${amendmentSnapshot.identificacao}` } : {}),
    }
    const event: HistoricoAlteracao = {
      id: crypto.randomUUID(),
      transferId: baixa.transferId,
      baixaId: baixa.id,
      action: exists ? 'Baixa atualizada' : 'Baixa criada',
      timestamp: new Date().toISOString(),
      description: baixa.description || (exists ? 'Dados da baixa atualizados.' : 'Novo registro de baixa criado.'),
      previousStatus: previous?.status,
      newStatus: baixa.status,
      previousAmount: previous?.paidAmount,
      newAmount: baixa.paidAmount,
      ...(savedBaixa.deputadoResponsavel ? { deputadoResponsavel: savedBaixa.deputadoResponsavel } : {}),
      ...(savedBaixa.emendaId ? { emendaId: savedBaixa.emendaId } : {}),
      ...(savedBaixa.emendaIdentificacao ? { emendaIdentificacao: savedBaixa.emendaIdentificacao } : {}),
      ...(savedBaixa.emendaSnapshot ? { emendaSnapshot: savedBaixa.emendaSnapshot } : {}),
      baixaSnapshot: snapshotBaixa(savedBaixa),
    }
    const next: PersistedData = {
      ...data,
      version: 2,
      baixas: exists ? data.baixas.map((item) => item.id === baixa.id ? savedBaixa : item) : [savedBaixa, ...data.baixas],
      history: [event, ...data.history],
    }
    return this.write(next)
  }

  delete(baixa: Baixa, deputadoResponsavel?: string, emenda?: EmendaEstadual): PersistedData {
    const data = this.load()
    const deputy = deputadoResponsavel?.trim() || baixa.deputadoResponsavel?.trim()
    const amendmentSnapshot = emenda ? snapshotEmenda(emenda) : baixa.emendaSnapshot
    const event: HistoricoAlteracao = {
      id: crypto.randomUUID(),
      transferId: baixa.transferId,
      baixaId: baixa.id,
      action: 'Baixa excluída',
      timestamp: new Date().toISOString(),
      description: 'Registro removido da demonstração local.',
      previousStatus: baixa.status,
      previousAmount: baixa.paidAmount,
      ...(deputy ? { deputadoResponsavel: deputy } : {}),
      ...(baixa.emendaId ? { emendaId: baixa.emendaId } : {}),
      ...(amendmentSnapshot ? { emendaId: amendmentSnapshot.id, emendaIdentificacao: `${amendmentSnapshot.uf} · ${amendmentSnapshot.identificacao}`, emendaSnapshot: amendmentSnapshot } : {}),
      baixaSnapshot: snapshotBaixa({ ...baixa, ...(deputy ? { deputadoResponsavel: deputy } : {}), ...(amendmentSnapshot ? { emendaSnapshot: amendmentSnapshot } : {}) }),
    }
    return this.write({ ...data, baixas: data.baixas.filter((item) => item.id !== baixa.id), history: [event, ...data.history] })
  }

  saveEmenda(emenda: EmendaEstadual): PersistedData {
    const data = this.load()
    const exists = data.emendas.some((item) => item.id === emenda.id)
    return this.write({
      ...data,
      emendas: exists ? data.emendas.map((item) => item.id === emenda.id ? emenda : item) : [emenda, ...data.emendas],
    })
  }

  deleteEmenda(emenda: EmendaEstadual): PersistedData {
    const data = this.load()
    return this.write({ ...data, emendas: data.emendas.filter((item) => item.id !== emenda.id) })
  }

  reset(): PersistedData {
    return this.write(initialData())
  }

  getFinancialComplement(key: string): SavedFnsFinancialComplement | null {
    const saved = this.load().financialComplements?.[key]
    if (!saved) return null
    if (!isSavedFinancialComplement(saved)) {
      throw new Error('Os complementos financeiros armazenados neste navegador estão em formato inválido.')
    }
    return saved
  }

  saveFinancialComplement(key: string, complement: FnsFinancialComplement): SavedFnsFinancialComplement {
    if (!key.trim()) throw new Error('Não foi possível identificar a consulta financeira para salvar os dados internos.')
    validateFinancialComplement(complement)
    const data = this.load()
    const saved: SavedFnsFinancialComplement = {
      observations: complement.observations,
      reviewStatus: complement.reviewStatus,
      reviewResponsible: complement.reviewResponsible.trim(),
      internalReference: complement.internalReference.trim(),
      updatedAt: new Date().toISOString(),
    }
    this.write({
      ...data,
      financialComplements: {
        ...data.financialComplements,
        [key]: saved,
      },
    })
    return saved
  }

  private write(data: PersistedData): PersistedData {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    return data
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBaixa(value: unknown): value is Baixa {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.transferId === 'string'
    && typeof value.beneficiary === 'string'
    && typeof value.paidAmount === 'number'
    && Number.isFinite(value.paidAmount)
    && typeof value.status === 'string'
    && typeof value.description === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

function isHistory(value: unknown): value is HistoricoAlteracao {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.transferId === 'string'
    && typeof value.baixaId === 'string'
    && typeof value.action === 'string'
    && typeof value.timestamp === 'string'
    && typeof value.description === 'string'
}

function isEmenda(value: unknown): value is EmendaEstadual {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.uf === 'string'
    && typeof value.identificacao === 'string'
    && typeof value.valor === 'number'
    && Number.isFinite(value.valor)
    && typeof value.objeto === 'string'
}

function snapshotBaixa(baixa: Baixa): Omit<Baixa, 'id' | 'transferId'> {
  const { id: _id, transferId: _transferId, ...snapshot } = baixa
  return snapshot
}

function snapshotEmenda(emenda: EmendaEstadual): EmendaSnapshot {
  return {
    id: emenda.id,
    uf: emenda.uf,
    identificacao: emenda.identificacao,
    valor: emenda.valor,
    objeto: emenda.objeto,
    ...(emenda.observacoes ? { observacoes: emenda.observacoes } : {}),
  }
}

const FINANCIAL_REVIEW_STATUSES = ['', 'Não iniciada', 'Em conferência', 'Conferida', 'Pendente de esclarecimento']

function validateFinancialComplement(complement: FnsFinancialComplement): void {
  if (typeof complement.observations !== 'string') throw new Error('Informe observações internas em formato de texto.')
  if (typeof complement.reviewResponsible !== 'string') throw new Error('Informe o responsável em formato de texto.')
  if (typeof complement.internalReference !== 'string') throw new Error('Informe a referência em formato de texto.')
  if (complement.observations.length > 2000) throw new Error('As observações devem ter no máximo 2.000 caracteres.')
  if (!FINANCIAL_REVIEW_STATUSES.includes(complement.reviewStatus)) throw new Error('Selecione uma situação de conferência válida.')
  if (complement.reviewResponsible.length > 120) throw new Error('O responsável deve ter no máximo 120 caracteres.')
  if (complement.internalReference.length > 80) throw new Error('A referência interna deve ter no máximo 80 caracteres.')
}

function isSavedFinancialComplement(value: unknown): value is SavedFnsFinancialComplement {
  return isRecord(value)
    && typeof value.observations === 'string'
    && typeof value.reviewStatus === 'string'
    && FINANCIAL_REVIEW_STATUSES.includes(value.reviewStatus)
    && typeof value.reviewResponsible === 'string'
    && typeof value.internalReference === 'string'
    && typeof value.updatedAt === 'string'
    && Number.isFinite(Date.parse(value.updatedAt))
}