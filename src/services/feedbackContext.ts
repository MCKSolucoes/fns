import { createContext, useContext } from 'react'

export type ToastKind = 'success' | 'error' | 'warning' | 'info'
type ConfirmationIcon = 'delete' | 'reset' | 'warning'

export interface ConfirmationOptions {
	title: string
	description: string
	confirmLabel: string
	icon?: ConfirmationIcon
	onConfirm: () => void | Promise<void>
}

export interface FeedbackContextValue {
	notify: (kind: ToastKind, message: string) => void
	requestConfirmation: (options: ConfirmationOptions) => Promise<boolean>
}

export const FeedbackContext = createContext<FeedbackContextValue | null>(null)

export function useFeedback(): FeedbackContextValue {
	const context = useContext(FeedbackContext)
	if (!context) throw new Error('useFeedback deve ser usado dentro de FeedbackProvider.')
	return context
}
