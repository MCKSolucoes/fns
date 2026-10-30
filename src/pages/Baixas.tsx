import { useEffect, useMemo, useRef, useState } from 'react'
import { History, Pencil, Plus, Trash2 } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAppData } from '../hooks/useAppData'
import { formatCurrency, formatDate, normalized, repasseLabel } from '../utils/formatters'
import StatusBadge from '../components/StatusBadge'
import { useFeedback } from '../services/feedbackContext'

export default function Baixas() {
	const { baixas, deleteBaixa, repasses, repassesLoading, repassesError, dataLoading, dataError, persistenceMode } = useAppData()
	const canWrite = persistenceMode === 'supabase'
	const location = useLocation()
	const navigate = useNavigate()
	const { requestConfirmation, notify } = useFeedback()
	const [saved] = useState(() => Boolean((location.state as { saved?: boolean } | null)?.saved))
	const saveNoticeShown = useRef(false)
	const [entity, setEntity] = useState('')
	const [document, setDocument] = useState('')
	const [city, setCity] = useState('')
	const [status, setStatus] = useState('')
	const [process, setProcess] = useState('')
	const [yearMonth, setYearMonth] = useState('')
	const [obFrom, setObFrom] = useState('')
	const [obTo, setObTo] = useState('')
	const [paidFrom, setPaidFrom] = useState('')
	const [paidTo, setPaidTo] = useState('')
	const [error, setError] = useState('')
	useEffect(() => {
		if (!saved || saveNoticeShown.current) return
		saveNoticeShown.current = true
		if (persistenceMode === 'supabase') notify('success', 'A baixa e o evento de histórico foram salvos no Supabase.')
		navigate(location.pathname, { replace: true, state: null })
	}, [location.pathname, navigate, notify, persistenceMode, saved])
	const rows = useMemo(() => baixas.map((baixa) => ({ baixa, repasse: repasses.find((item) => item.id === baixa.transferId) })).filter(({ baixa, repasse }) => {
		if (!repasse) return false
		return (!entity || normalized(`${repasse.entity} ${baixa.beneficiary}`).includes(normalized(entity))) && (!document || normalized(repasse.document).includes(normalized(document))) && (!city || normalized(repasse.city).includes(normalized(city))) && (!status || baixa.status === status) && (!process || normalized(repasse.processNumber).includes(normalized(process))) && (!yearMonth || `${repasse.year}-${String(repasse.month).padStart(2, '0')}` === yearMonth) && (!obFrom || (repasse.bankOrderDate ?? '') >= obFrom) && (!obTo || (repasse.bankOrderDate ?? '') <= obTo) && (!paidFrom || (baixa.paymentDate ?? '') >= paidFrom) && (!paidTo || (baixa.paymentDate ?? '') <= paidTo)
	}), [baixas, repasses, entity, document, city, status, process, yearMonth, obFrom, obTo, paidFrom, paidTo])
	const resetFilters = () => { setEntity(''); setDocument(''); setCity(''); setStatus(''); setProcess(''); setYearMonth(''); setObFrom(''); setObTo(''); setPaidFrom(''); setPaidTo(''); setError('') }
	const remove = (id: string) => {
		const baixa = baixas.find((item) => item.id === id)
		if (!baixa) {
			notify('error', 'Não foi possível localizar o registro de baixa para excluir.')
				return
		}
		void requestConfirmation({
			title: 'Excluir registro de baixa?',
			description: 'Tem certeza de que deseja excluir este registro? Essa ação será registrada no histórico compartilhado.',
			confirmLabel: 'Excluir registro',
			icon: 'delete',
			onConfirm: async () => {
				try {
					await deleteBaixa(baixa)
					notify('success', 'O registro foi excluído e registrado no histórico do Supabase.')
				} catch (deleteError) {
					notify('error', deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir a baixa.')
				}
			},
		})
	}
	const filters: { label: string; value: string; update: (value: string) => void; type?: string; placeholder?: string }[] = [
		{ label: 'Entidade ou beneficiário', value: entity, update: setEntity, placeholder: 'Buscar por nome' }, { label: 'CPF/CNPJ', value: document, update: setDocument, placeholder: 'Documento' },
		{ label: 'Município', value: city, update: setCity, placeholder: 'Município' }, { label: 'Número do processo', value: process, update: setProcess, placeholder: 'Número do processo' },
		{ label: 'Ano e mês do repasse', value: yearMonth, update: setYearMonth, type: 'month' }, { label: 'OB: data inicial', value: obFrom, update: (value) => { setObFrom(value); setError(obTo && value > obTo ? 'A data inicial da OB não pode ser posterior à data final.' : '') }, type: 'date' },
		{ label: 'OB: data final', value: obTo, update: (value) => { setObTo(value); setError(obFrom && value < obFrom ? 'A data final da OB não pode ser anterior à data inicial.' : '') }, type: 'date' },
		{ label: 'Pagamento: data inicial', value: paidFrom, update: (value) => { setPaidFrom(value); setError(paidTo && value > paidTo ? 'A data inicial do pagamento não pode ser posterior à data final.' : '') }, type: 'date' },
		{ label: 'Pagamento: data final', value: paidTo, update: (value) => { setPaidTo(value); setError(paidFrom && value < paidFrom ? 'A data final do pagamento não pode ser anterior à data inicial.' : '') }, type: 'date' },
	]
	return <div className="page-content"><div className="page-heading"><div><h2>Controle de baixas</h2><p>Administre o acompanhamento interno dos pagamentos.</p></div>{canWrite ? <Link to="/consultas" className="button button-primary"><Plus size={15} /> Nova baixa por repasse demonstrativo</Link> : <button className="button button-primary" type="button" disabled><Plus size={15} /> Nova baixa por repasse demonstrativo</button>}</div>
		{repassesLoading && <div className="notice" role="status">Carregando repasses…</div>}{repassesError && <div className="notice notice-error" role="alert">{repassesError}</div>}<div className="notice notice-amber"><History size={15} /> Status e pagamentos são controles internos demonstrativos; não alteram dados oficiais do FNS.</div>
		{dataError && <div role="alert" className="notice notice-error">{dataError}</div>}
		<section className="filter-panel" style={{ marginTop: 15 }}><div className="filter-grid">{filters.slice(0, 3).map((item) => <Filter key={item.label} {...item} />)}<div className="field"><label htmlFor="baixa-status-filter">Status</label><select id="baixa-status-filter" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option>{['Pendente', 'Em processamento', 'Pago', 'Pago parcialmente', 'Cancelado'].map((item) => <option key={item}>{item}</option>)}</select></div>{filters.slice(3).map((item) => <Filter key={item.label} {...item} />)}</div>{error && <div role="alert" className="notice notice-error" style={{ marginTop: 12 }}>{error}</div>}<div className="filter-actions"><button className="button" onClick={resetFilters}>Limpar filtros</button><span style={{ color: 'var(--muted)', fontSize: 11 }}>{rows.length} registro(s)</span></div></section>
		<section className="table-panel"><div className="table-toolbar"><strong>Registros de baixa</strong><span>{rows.length} registro(s)</span></div>{dataLoading ? <div className="empty-state" role="status">Carregando baixas…</div> : rows.length ? <div className="table-scroll"><table><thead><tr><th>Entidade</th><th>Beneficiário</th><th>Identificação do repasse</th><th>Valor líquido</th><th>Valor pago</th><th>Data da OB</th><th>Data do pagamento</th><th>Status</th><th>Atualização</th><th>Ações</th></tr></thead><tbody>{rows.map(({ baixa, repasse }) => <tr key={baixa.id}><td>{repasse!.entity}</td><td>{baixa.beneficiary}</td><td>{repasseLabel(repasse!)}</td><td>{formatCurrency(repasse!.netAmount)}</td><td>{formatCurrency(baixa.paidAmount)}</td><td>{formatDate(repasse!.bankOrderDate)}</td><td>{formatDate(baixa.paymentDate)}</td><td><StatusBadge status={baixa.status} /></td><td>{formatDate(baixa.updatedAt.slice(0, 10))}</td><td><div className="table-actions">{canWrite && <><Link className="text-action" title="Editar baixa" aria-label="Editar baixa" to={`/baixas/${repasse!.id}`}><Pencil size={15} /></Link><button className="text-action" title="Excluir registro" aria-label="Excluir registro de baixa" onClick={() => remove(baixa.id)}><Trash2 size={15} /></button></>}<Link className="text-action" title="Consultar histórico" aria-label="Consultar histórico" to="/historico"><History size={15} /></Link></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><History size={25} /><strong>Nenhuma baixa encontrada</strong><span>Ajuste os filtros ou inicie uma baixa na tela de Consultas FNS.</span></div>}</section>
	</div>
}

function Filter({ label, value, update, type = 'text', placeholder }: { label: string; value: string; update: (value: string) => void; type?: string; placeholder?: string }) { const id = `baixas-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`; return <div className="field"><label htmlFor={id}>{label}</label><input id={id} type={type} value={value} placeholder={placeholder} onChange={(event) => update(event.target.value)} /></div> }
