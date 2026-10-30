import type { BaixaStatus } from '../types'

const classes: Record<BaixaStatus, string> = {
	Pendente: 'status-pendente',
	'Em processamento': 'status-em-processamento',
	Pago: 'status-pago',
	'Pago parcialmente': 'status-pago-parcialmente',
	Cancelado: 'status-cancelado',
}

export default function StatusBadge({ status }: { status: BaixaStatus }) {
	return <span className={`status-badge ${classes[status]}`}><span aria-hidden="true">●</span>{status}</span>
}
