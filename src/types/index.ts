export type BaixaStatus = 'Pendente' | 'Em processamento' | 'Pago' | 'Pago parcialmente' | 'Cancelado'

export interface Repasse {
	id: string
	storageId?: string
	year: number
	month: number
	entity: string
	beneficiary: string
	document: string
	city: string
	state: string
	municipalityIbge?: string
	block: string
	group: string
	action: string
	detailedAction: string
	processNumber: string
	bankOrderNumber?: string
	bankOrderDate?: string
	dueDate?: string
	grossAmount: number
	discountAmount: number
	netAmount: number
	hasOfficialNetAmount?: boolean
	transferType: string
	portaria: string
}

export interface Baixa {
	id: string
	transferId: string
	repasseId?: string
	beneficiary: string
	document?: string
	paidAmount: number
	paymentDate?: string
	status: BaixaStatus
	description: string
	documentReference?: string
	deputadoId?: string
	deputadoResponsavel?: string
	emendaId?: string
	emendaIdentificacao?: string
	emendaSnapshot?: EmendaSnapshot
	repasseSnapshot?: Partial<Repasse>
	createdAt: string
	updatedAt: string
}

export interface Deputado {
	id: string
	nome: string
	partido?: string
	uf?: string
	observacoes?: string
}

export interface EmendaEstadual {
	id: string
	uf: string
	identificacao: string
	valor: number
	objeto: string
	observacoes?: string
}

export type EmendaSnapshot = Pick<EmendaEstadual, 'id' | 'uf' | 'identificacao' | 'valor' | 'objeto' | 'observacoes'>

export interface HistoricoAlteracao {
	id: string
	transferId: string
	baixaId: string
	action: string
	timestamp: string
	description: string
	previousStatus?: BaixaStatus
	newStatus?: BaixaStatus
	previousAmount?: number
	newAmount?: number
	deputadoResponsavel?: string
	emendaId?: string
	emendaIdentificacao?: string
	emendaSnapshot?: EmendaSnapshot
	baixaSnapshot?: Omit<Baixa, 'id' | 'transferId'>
}

export interface ConsultationFilters {
	year: string
	month: string
	queryType: string
	block: string
	group: string
	document: string
	state: string
	city: string
	cityCode: string
	processNumber: string
	proposal: string
	transferType: string
	dateFrom: string
	dateTo: string
	portaria: string
}

export interface Pagination {
	page: number
	pageSize: number
	total: number
}

export interface PersistedData {
	version: 2
	baixas: Baixa[]
	history: HistoricoAlteracao[]
	emendas: EmendaEstadual[]
	financialComplements?: Record<string, import('./fnsFinancial').SavedFnsFinancialComplement>
}
