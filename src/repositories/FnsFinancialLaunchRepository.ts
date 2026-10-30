import type { FnsFinancialLaunch } from '../types/fnsFinancial'

export interface FnsFinancialLaunchRepository {
  getByActionKey(actionKey: string): Promise<FnsFinancialLaunch | null>
  save(launch: Omit<FnsFinancialLaunch, 'createdAt' | 'updatedAt'>): Promise<FnsFinancialLaunch>
  update(launch: FnsFinancialLaunch): Promise<FnsFinancialLaunch>
}
