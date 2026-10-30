import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react'
import { useAuth } from './authSession'

interface BackendSessionContextValue {
	accessToken: string
	setAccessToken: (token: string) => void
	hasSharedAccess: boolean
	sharedStorageLoading: boolean
	sharedStorageError: string
}

const BackendSessionContext = createContext<BackendSessionContextValue | null>(null)

function storageErrorMessage(code: string): string {
	switch (code) {
		case 'SUPABASE_NOT_CONFIGURED':
			return 'A configuração do armazenamento compartilhado está incompleta no backend.'
		case 'SUPABASE_TABLE_UNAVAILABLE':
			return 'Uma tabela necessária ainda não está disponível no Supabase.'
		case 'SUPABASE_COLUMN_UNAVAILABLE':
			return 'Uma coluna necessária ainda não está disponível no Supabase.'
		case 'SUPABASE_RELATION_UNAVAILABLE':
			return 'Um relacionamento necessário ainda não está disponível no Supabase.'
		case 'SUPABASE_PERMISSION_DENIED':
			return 'O Supabase negou acesso a uma operação necessária.'
		case 'SUPABASE_AUTH_FAILED':
			return 'A conexão do servidor com o Supabase não foi autenticada.'
		case 'SUPABASE_TIMEOUT':
			return 'O Supabase demorou para responder. Tente novamente.'
		case 'SUPABASE_NETWORK_ERROR':
		case 'SUPABASE_UNAVAILABLE':
			return 'Não foi possível conectar ao Supabase de desenvolvimento.'
		default:
			return 'Não foi possível verificar a conexão compartilhada.'
	}
}

export function BackendSessionProvider({ children }: PropsWithChildren) {
	const { accessToken, authRequired } = useAuth()
	const [testStorageEnabled, setTestStorageEnabled] = useState(false)
	const [testStorageLoading, setTestStorageLoading] = useState(true)
	const [testStorageError, setTestStorageError] = useState('')

	useEffect(() => {
		if (authRequired) return

		let active = true
		fetch('/api/storage/status', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
			.then(async (response) => {
				let value: unknown
				try {
					value = await response.json() as unknown
				} catch {
					throw new Error('Não foi possível verificar a conexão compartilhada.')
				}
				if (!response.ok) {
					const error = typeof value === 'object' && value !== null
						? (value as { error?: { code?: unknown } }).error
						: undefined
					throw new Error(typeof error?.code === 'string'
						? storageErrorMessage(error.code)
						: 'Não foi possível verificar a conexão compartilhada.')
				}
				if (typeof value !== 'object' || value === null || !('sharedStorageEnabled' in value)
					|| typeof value.sharedStorageEnabled !== 'boolean') {
					throw new Error('O backend retornou um estado de conexão inválido.')
				}
				if (active) {
					setTestStorageEnabled(value.sharedStorageEnabled)
					setTestStorageError('')
				}
			})
			.catch((error: unknown) => {
				if (active) setTestStorageError(error instanceof Error ? error.message : 'Não foi possível verificar a conexão compartilhada.')
			})
			.finally(() => {
				if (active) setTestStorageLoading(false)
			})
		return () => { active = false }
	}, [authRequired])

	const sharedStorageLoading = authRequired ? false : testStorageLoading
	const sharedStorageError = authRequired ? '' : testStorageError

	return <BackendSessionContext.Provider value={{
		accessToken,
		setAccessToken: () => {},
		hasSharedAccess: Boolean(accessToken) || testStorageEnabled,
		sharedStorageLoading,
		sharedStorageError,
	}}>{children}</BackendSessionContext.Provider>
}

export function useBackendSession() {
	const value = useContext(BackendSessionContext)
	if (!value) throw new Error('useBackendSession deve ser usado dentro de BackendSessionProvider')
	return value
}
