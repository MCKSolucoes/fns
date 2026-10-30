import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react'
import { AlertTriangle, CheckCircle2, Info, LoaderCircle, RotateCcw, Trash2, X, XCircle } from 'lucide-react'
import { FeedbackContext, type ConfirmationOptions, type ToastKind } from '../services/feedbackContext'

interface ToastMessage {
	id: number
	kind: ToastKind
	message: string
}

interface PendingConfirmation extends ConfirmationOptions {
	resolve: (confirmed: boolean) => void
}

const toastIcons = {
	success: CheckCircle2,
	error: XCircle,
	warning: AlertTriangle,
	info: Info,
}

const confirmationIcons = {
	delete: Trash2,
	reset: RotateCcw,
	warning: AlertTriangle,
}

export function FeedbackProvider({ children }: PropsWithChildren) {
	const [toasts, setToasts] = useState<ToastMessage[]>([])
	const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null)
	const [confirming, setConfirming] = useState(false)
	const confirmationRef = useRef<PendingConfirmation | null>(null)
	const confirmingRef = useRef(false)
	const nextToastId = useRef(0)
	const confirmButtonRef = useRef<HTMLButtonElement>(null)
	const cancelButtonRef = useRef<HTMLButtonElement>(null)
	const previouslyFocusedRef = useRef<HTMLElement | null>(null)

	const notify = useCallback((kind: ToastKind, message: string) => {
		const id = ++nextToastId.current
		setToasts((current) => [...current, { id, kind, message }])
		window.setTimeout(() => {
			setToasts((current) => current.filter((toast) => toast.id !== id))
		}, 5000)
	}, [])

	const dismissConfirmation = useCallback((confirmed: boolean) => {
		const pending = confirmationRef.current
		if (!pending || confirmingRef.current) return
		confirmationRef.current = null
		pending.resolve(confirmed)
		setConfirmation(null)
		window.requestAnimationFrame(() => previouslyFocusedRef.current?.focus())
	}, [])

	const requestConfirmation = useCallback((options: ConfirmationOptions) => new Promise<boolean>((resolve) => {
		if (confirmationRef.current || confirmingRef.current) {
			resolve(false)
			return
		}
		previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
		const pending = { ...options, resolve }
		confirmationRef.current = pending
		setConfirmation(pending)
	}), [])

	useEffect(() => {
		if (!confirmation) return
		cancelButtonRef.current?.focus()
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !confirming) {
				event.preventDefault()
				dismissConfirmation(false)
				return
			}
			if (event.key !== 'Tab') return
			const focusable = [cancelButtonRef.current, confirmButtonRef.current].filter((element): element is HTMLButtonElement =>
				element !== null && !element.disabled,
			)
			if (!focusable.length) return
			const first = focusable[0]
			const last = focusable[focusable.length - 1]
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault()
				last.focus()
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault()
				first.focus()
			}
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [confirmation, confirming, dismissConfirmation])

	const runConfirmation = async () => {
		const pending = confirmationRef.current
		if (!pending || confirmingRef.current) return
		confirmingRef.current = true
		setConfirming(true)
		try {
			await pending.onConfirm()
			confirmationRef.current = null
			pending.resolve(true)
			setConfirmation(null)
			window.requestAnimationFrame(() => previouslyFocusedRef.current?.focus())
		} catch (error) {
			notify('error', error instanceof Error ? error.message : 'Não foi possível concluir a operação.')
		} finally {
			confirmingRef.current = false
			setConfirming(false)
		}
	}

	const ConfirmationIconComponent = confirmation ? confirmationIcons[confirmation.icon ?? 'warning'] : AlertTriangle

	return <FeedbackContext.Provider value={{ notify, requestConfirmation }}>
		{children}
		<div className="toast-region" aria-label="Notificações" aria-live="polite" aria-relevant="additions">
			{toasts.map((toast) => {
				const Icon = toastIcons[toast.kind]
				return <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
					<Icon size={19} aria-hidden="true" />
					<span>{toast.message}</span>
					<button className="toast-dismiss" type="button" aria-label="Dispensar notificação" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}><X size={16} /></button>
				</div>
			})}
		</div>
		{confirmation && <div className="dialog-overlay dialog-overlay-confirmation" onMouseDown={(event) => {
			if (event.target === event.currentTarget && !confirming) dismissConfirmation(false)
		}}>
			<section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-description" aria-busy={confirming}>
				<div className={`confirm-dialog-icon confirm-dialog-icon-${confirmation.icon ?? 'warning'}`}><ConfirmationIconComponent size={22} aria-hidden="true" /></div>
				<h2 id="confirm-dialog-title">{confirmation.title}</h2>
				<p id="confirm-dialog-description">{confirmation.description}</p>
				<div className="confirm-dialog-actions">
					<button ref={cancelButtonRef} className="button" type="button" disabled={confirming} onClick={() => dismissConfirmation(false)}>Cancelar</button>
					<button ref={confirmButtonRef} className="button button-danger" type="button" disabled={confirming} onClick={() => void runConfirmation()}>
						{confirming ? <><LoaderCircle className="button-spinner" size={15} /> Processando…</> : confirmation.confirmLabel}
					</button>
				</div>
			</section>
		</div>}
	</FeedbackContext.Provider>
}
