import type { FnsFinancialLaunch, FnsFinancialLaunchStatus } from '../types/fnsFinancial'
import { isValidFnsFinancialLaunchDate, parseFnsFinancialLaunchAmount } from '../utils/fnsFinancialLaunch'
import type { FnsFinancialLaunchRepository } from './FnsFinancialLaunchRepository'

const STORAGE_KEY = 'fns-financial-launch-drafts:v1'
const statuses: FnsFinancialLaunchStatus[] = ['Pendente', 'Em análise', 'Conferido', 'Lançado']

interface StoredLaunches {
  version: 1
  launches: Record<string, FnsFinancialLaunch>
}

export class LocalStorageFnsFinancialLaunchRepository implements FnsFinancialLaunchRepository {
  async getByActionKey(actionKey: string): Promise<FnsFinancialLaunch | null> {
    if (!actionKey.trim()) throw new Error('Não foi possível identificar a ação financeira.')
    const launch = this.read().launches[actionKey]
    if (launch && !isFnsFinancialLaunch(launch, actionKey)) {
      throw new Error('O rascunho financeiro armazenado está em formato inválido.')
    }
    return launch ?? null
  }

  async save(launch: Omit<FnsFinancialLaunch, 'createdAt' | 'updatedAt'>): Promise<FnsFinancialLaunch> {
    validateLaunch(launch)
    const stored = this.read()
    if (stored.launches[launch.actionKey]) {
      throw new Error('Já existe um rascunho para esta ação. Reabra-o para salvar as alterações.')
    }
    const timestamp = new Date().toISOString()
    const saved: FnsFinancialLaunch = { ...launch, createdAt: timestamp, updatedAt: timestamp }
    this.write({ ...stored, launches: { ...stored.launches, [saved.actionKey]: saved } })
    return saved
  }

  async update(launch: FnsFinancialLaunch): Promise<FnsFinancialLaunch> {
    validateLaunch(launch)
    const stored = this.read()
    const previous = stored.launches[launch.actionKey]
    if (!previous || !isFnsFinancialLaunch(previous, launch.actionKey)) {
      throw new Error('O rascunho desta ação não foi encontrado. Reabra a edição antes de salvar.')
    }
    const updated: FnsFinancialLaunch = {
      ...launch,
      createdAt: previous.createdAt,
      updatedAt: new Date().toISOString(),
    }
    this.write({ ...stored, launches: { ...stored.launches, [updated.actionKey]: updated } })
    return updated
  }

  private read(): StoredLaunches {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { version: 1, launches: {} }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      throw new Error('Os rascunhos financeiros locais não puderam ser lidos: armazenamento inválido.')
    }
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.launches)) {
      throw new Error('Os rascunhos financeiros locais não puderam ser lidos: formato incompatível.')
    }
    return parsed as unknown as StoredLaunches
  }

  private write(data: StoredLaunches): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFnsFinancialLaunch(value: unknown, actionKey: string): value is FnsFinancialLaunch {
  if (!isRecord(value)) return false
  return value.actionKey === actionKey
    && statuses.includes(value.status as FnsFinancialLaunchStatus)
    && typeof value.amount === 'string'
    && typeof value.date === 'string'
    && typeof value.documentNumber === 'string'
    && typeof value.accountReference === 'string'
    && typeof value.responsible === 'string'
    && typeof value.observations === 'string'
    && typeof value.createdAt === 'string'
    && Number.isFinite(Date.parse(value.createdAt))
    && typeof value.updatedAt === 'string'
    && Number.isFinite(Date.parse(value.updatedAt))
}

function validateLaunch(launch: Omit<FnsFinancialLaunch, 'createdAt' | 'updatedAt'> | FnsFinancialLaunch): void {
  if (!launch.actionKey.trim()) throw new Error('Não foi possível identificar a ação financeira.')
  if (!statuses.includes(launch.status)) throw new Error('Selecione uma situação válida para o lançamento.')
  const amount = typeof launch.amount === 'string' ? parseFnsFinancialLaunchAmount(launch.amount) : undefined
  if (amount === undefined || amount < 0 || launch.amount.length > 24) throw new Error('Informe um valor lançado numérico e não negativo.')
  if (typeof launch.date !== 'string' || !isValidDate(launch.date)) throw new Error('Informe uma data de lançamento válida.')
  if (typeof launch.documentNumber !== 'string' || launch.documentNumber.length > 120) throw new Error('O número do documento deve ter no máximo 120 caracteres.')
  if (typeof launch.accountReference !== 'string' || launch.accountReference.length > 160) throw new Error('A conta ou referência deve ter no máximo 160 caracteres.')
  if (typeof launch.responsible !== 'string' || launch.responsible.length > 120) throw new Error('O responsável deve ter no máximo 120 caracteres.')
  if (typeof launch.observations !== 'string' || launch.observations.length > 2000) throw new Error('As observações devem ter no máximo 2.000 caracteres.')
}

function isValidDate(value: string): boolean {
  return isValidFnsFinancialLaunchDate(value)
}
