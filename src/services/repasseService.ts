import { mockRepasses } from '../data/mockRepasses'
import type { Repasse } from '../types'

export const FNS_YEARS_ENDPOINT = 'https://consultafns.saude.gov.br/recursos/anos'

export interface RepasseRepository {
	list(): Promise<Repasse[]>
}

export const repasseRepository: RepasseRepository = {
	list: async () => mockRepasses,
}
