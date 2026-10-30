import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { useAppData } from '../hooks/useAppData'
import { formatCurrency, formatDateTime, normalized, repasseLabel } from '../utils/formatters'
import StatusBadge from '../components/StatusBadge'

export default function Historico() {
	const { history, repasses } = useAppData()
	const [query, setQuery] = useState('')
	const rows = useMemo(() => history.filter((item) => {
		const repasse = repasses.find((entry) => entry.id === item.transferId)
		return normalized(`${item.action} ${item.description} ${repasse?.entity ?? ''} ${repasse?.processNumber ?? ''}`).includes(normalized(query))
	}), [history, query, repasses])
	return <div className="page-content"><div className="page-heading"><div><h2>Histórico de alterações</h2><p>Eventos demonstrativos registrados neste navegador.</p></div></div>
		<div className="notice notice-amber"><History size={15} /> Histórico local para demonstração; não é auditoria inviolável nem substitui persistência de auditoria no servidor.</div>
		<div className="filter-panel" style={{ marginTop: 15 }}><div className="field" style={{ maxWidth: 470 }}><label htmlFor="history-search">Buscar alterações</label><input id="history-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Entidade, processo ou descrição" /></div></div>
		<section className="table-panel"><div className="table-toolbar"><strong>Eventos registrados</strong><span>{rows.length} evento(s)</span></div>{rows.length ? <div className="history-list">{rows.map((item) => { const repasse = repasses.find((entry) => entry.id === item.transferId); return <article className="history-item" key={item.id}><div className="history-date">{formatDateTime(item.timestamp)}</div><div><div className="history-title">{item.action}</div><div className="secondary-cell">{repasse ? repasseLabel(repasse) : item.transferId}</div></div><div className="history-description">{item.description}{item.previousAmount !== undefined || item.newAmount !== undefined ? <div className="secondary-cell">Valor: {item.previousAmount !== undefined ? formatCurrency(item.previousAmount) : '—'} → {item.newAmount !== undefined ? formatCurrency(item.newAmount) : '—'}</div> : null}</div><div>{item.previousStatus && <div className="secondary-cell">Anterior: <StatusBadge status={item.previousStatus} /></div>}{item.newStatus && <div style={{ marginTop: 5 }}><StatusBadge status={item.newStatus} /></div>}</div></article>})}</div> : <div className="empty-state"><History size={25} /><strong>{query ? 'Nenhum evento encontrado' : 'Nenhum evento registrado'}</strong><span>{query ? 'Tente uma busca diferente.' : 'As alterações realizadas nas baixas aparecerão aqui.'}</span></div>}</section>
	</div>
}
