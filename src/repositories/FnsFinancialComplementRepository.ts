import type { FnsFinancialComplement, SavedFnsFinancialComplement } from '../types/fnsFinancial'

export interface FnsFinancialComplementRepository {
  getFinancialComplement(key: string): SavedFnsFinancialComplement | null
  saveFinancialComplement(key: string, complement: FnsFinancialComplement): SavedFnsFinancialComplement
}
