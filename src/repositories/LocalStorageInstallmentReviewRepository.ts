export interface InstallmentReview {
	status: 'Pendente' | 'Analisado'
	justificativa: string
	updatedAt: string
}

const STORAGE_KEY = 'fns-installment-reviews:v1'

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInstallmentReview(value: unknown): value is InstallmentReview {
	return isRecord(value)
		&& (value.status === 'Pendente' || value.status === 'Analisado')
		&& typeof value.justificativa === 'string'
		&& typeof value.updatedAt === 'string'
}

export class LocalStorageInstallmentReviewRepository {
	load(): Record<string, InstallmentReview> {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return {}
		const parsed: unknown = JSON.parse(raw)
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error('Os status de análise salvos localmente têm formato inválido.')
		}
		const reviews: Record<string, InstallmentReview> = {}
		for (const [key, value] of Object.entries(parsed)) {
			if (!isInstallmentReview(value)) throw new Error('Os status de análise salvos localmente têm formato inválido.')
			reviews[key] = value
		}
		return reviews
	}

	save(key: string, review: InstallmentReview): Record<string, InstallmentReview> {
		const next = { ...this.load(), [key]: review }
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
		return next
	}
}
