export class BackendApiError extends Error {
	readonly status: number
	readonly code: string

	constructor(message: string, status: number, code: string) {
		super(message)
		this.name = 'BackendApiError'
		this.status = status
		this.code = code
	}
}

export async function backendRequest<T>(
	path: string,
	accessToken = '',
	options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
	let response: Response
	try {
		response = await fetch(path, {
			method: options.method ?? 'GET',
			credentials: 'same-origin',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${accessToken}`,
				...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
				...((options.method ?? 'GET') === 'GET' ? {} : { 'X-Requested-With': 'XMLHttpRequest' }),
			},
			...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
		})
	} catch (error) {
		if (error instanceof TypeError) {
			throw new BackendApiError('Não foi possível conectar ao backend. Verifique a conexão e tente novamente.', 0, 'BACKEND_UNAVAILABLE')
		}
		throw error
	}
	if (response.status === 204) return undefined as T
	let payload: unknown
	try {
		payload = await response.json() as unknown
	} catch {
		throw new BackendApiError('O backend retornou uma resposta inválida.', response.status, 'INVALID_RESPONSE')
	}
	if (!response.ok) {
		const error = typeof payload === 'object' && payload !== null
			? (payload as { error?: { message?: unknown; code?: unknown } }).error
			: undefined
		throw new BackendApiError(
			typeof error?.message === 'string' ? error.message : `A operação falhou (HTTP ${response.status}).`,
			response.status,
			typeof error?.code === 'string' ? error.code : 'BACKEND_ERROR',
		)
	}
	return payload as T
}
