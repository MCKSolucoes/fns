import { useState, type FormEvent } from 'react'
import { ArrowLeft, Save } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAppData } from '../hooks/useAppData'
import type { Baixa, BaixaStatus, Repasse } from '../types'
import { formatCurrency, formatDate, repasseLabel, transferBalance } from '../utils/formatters'
import { baixaStatuses, validateBaixa } from '../utils/validateBaixa'
import { useFeedback } from '../services/feedbackContext'

export default function BaixaForm() {
	const { id = '' } = useParams()
	const { baixas, saveBaixa, deleteBaixa, repasses, deputies, emendas, repassesLoading, repassesError, dataLoading, dataError, persistenceMode } = useAppData()
	const repasse = repasses.find((item) => item.id === id)
	const existing = baixas.find((item) => item.transferId === id)
	if (dataLoading) return <div className="page-content"><div className="notice" role="status">Verificando conexão com o Supabase…</div></div>
	if (persistenceMode !== 'supabase') return <div className="page-content"><div className="notice notice-error" role="alert">{dataError || 'A conexão com o Supabase de desenvolvimento não está ativa. Nenhuma baixa pode ser registrada ou alterada.'}</div><Link className="button" to="/baixas" style={{ marginTop: 15 }}>Voltar</Link></div>
	if (repassesLoading) return <div className="page-content"><div className="notice" role="status">Carregando repasse…</div></div>
	if (!repasse) return <div className="page-content"><div className="notice notice-error">{repassesError || 'Repasse não encontrado na base demonstrativa.'}</div><Link className="button" to="/consultas" style={{ marginTop: 15 }}>Voltar às consultas</Link></div>
	return <BaixaFormEditor key={`${repasse.id}-${existing?.updatedAt ?? 'new'}`} repasse={repasse} existing={existing} deputies={deputies} emendas={emendas} saveBaixa={saveBaixa} deleteBaixa={deleteBaixa} />
}


function BaixaFormEditor({ repasse, existing, deputies, emendas, saveBaixa, deleteBaixa }: { repasse: Repasse; existing?: Baixa; deputies: ReturnType<typeof useAppData>['deputies']; emendas: ReturnType<typeof useAppData>['emendas']; saveBaixa: (baixa: Baixa, previous?: Baixa, deputadoResponsavel?: string, emendaId?: string) => Promise<void>; deleteBaixa: (baixa: Baixa) => Promise<void> }) {
	const navigate = useNavigate()
	const { requestConfirmation, notify } = useFeedback()
	const [beneficiary, setBeneficiary] = useState(existing?.beneficiary ?? repasse.beneficiary)
	const [document, setDocument] = useState(existing?.document ?? repasse.document)
	const [paidAmount, setPaidAmount] = useState(String(existing?.paidAmount ?? 0))
	const [paymentDate, setPaymentDate] = useState(existing?.paymentDate ?? '')
	const [status, setStatus] = useState<BaixaStatus>(existing?.status ?? 'Pendente')
	const [description, setDescription] = useState(existing?.description ?? '')
	const [documentReference, setDocumentReference] = useState(existing?.documentReference ?? '')
	const [deputadoId, setDeputadoId] = useState(existing?.deputadoId ?? '')
	const [deputadoNomeManual, setDeputadoNomeManual] = useState(existing?.deputadoResponsavel ?? '')
	const [emendaId, setEmendaId] = useState(existing?.emendaId ?? '')
	const [error, setError] = useState('')
	const amount = Number(paidAmount.replace(',', '.'))
	const selectedDeputy = deputies.find((deputy) => deputy.id === deputadoId)
	const deputadoResponsavel = (selectedDeputy?.nome ?? deputadoNomeManual.trim()) || undefined
	const draft: Baixa = { id: existing?.id ?? `baixa-${repasse.id}`, transferId: repasse.id, beneficiary, document, paidAmount: amount, paymentDate: paymentDate || undefined, status, description, documentReference: documentReference || undefined, deputadoId: deputadoId || undefined, deputadoResponsavel, emendaId: emendaId || undefined, createdAt: existing?.createdAt ?? '', updatedAt: '' }
	const balance = transferBalance(repasse, { paidAmount: Number.isFinite(amount) ? amount : 0 } as Baixa)
	const save = async (event: FormEvent) => {
		event.preventDefault()
		const validation = validateBaixa(draft, repasse.netAmount)
		if (validation) { setError(validation); return }
		if (status === 'Cancelado' && existing?.status !== 'Cancelado') {
			const confirmed = await requestConfirmation({
				title: 'Confirmar cancelamento da baixa?',
				description: 'O cancelamento ficará registrado no histórico compartilhado. Deseja continuar?',
				confirmLabel: 'Confirmar cancelamento',
				icon: 'warning',
				onConfirm: () => {},
			})
			if (!confirmed) return
		}
		setError('')
		const now = new Date().toISOString()
		try {
			await saveBaixa({ ...draft, createdAt: existing?.createdAt ?? now, updatedAt: now }, existing, deputadoResponsavel, emendaId)
			navigate('/baixas', { state: { saved: true } })
		} catch (saveError) {
			notify('error', saveError instanceof Error ? saveError.message : 'Não foi possível salvar a baixa.')
		}
	}
	const remove = () => {
		if (!existing) return
		void requestConfirmation({
			title: 'Excluir registro de baixa?',
			description: 'Tem certeza de que deseja excluir este registro? Essa ação será registrada no histórico compartilhado.',
			confirmLabel: 'Excluir registro',
			icon: 'delete',
			onConfirm: async () => {
				try {
					await deleteBaixa(existing)
					notify('success', 'O registro de baixa foi excluído e registrado no histórico compartilhado.')
					navigate('/baixas')
				} catch (deleteError) {
					notify('error', deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir a baixa.')
				}
			},
		})
	}

	return <div className="page-content"><div className="page-heading"><div><h2>{existing ? 'Editar baixa' : 'Registrar baixa'}</h2><p>{repasseLabel(repasse)} · {repasse.entity}</p></div><Link to="/baixas" className="button"><ArrowLeft size={14} /> Voltar</Link></div>
		<div className="notice notice-amber"><Save size={15} /> Informe manualmente a data efetiva do pagamento. Ela é independente da criação e atualização deste registro.</div>
		<form onSubmit={save}><div className="form-layout" style={{ marginTop: 15 }}><section className="form-card"><h3>Dados da baixa</h3><div className="form-grid">
			<ReadOnly label="Identificador do repasse" value={repasse.id} /><ReadOnly label="Entidade responsável" value={repasse.entity} />
			<TextField label="Funcionário ou beneficiário" value={beneficiary} onChange={setBeneficiary} required /><TextField label="CPF ou identificação" value={document} onChange={setDocument} />
			<ReadOnly label="Valor líquido do repasse" value={formatCurrency(repasse.netAmount)} /><TextField label="Valor efetivamente pago (R$)" value={paidAmount} onChange={setPaidAmount} type="number" min="0" step="0.01" required />
			<div className="field"><label htmlFor="baixa-deputy">Deputado cadastrado</label><select id="baixa-deputy" value={deputadoId} onChange={(event) => { setDeputadoId(event.target.value); if (event.target.value) setDeputadoNomeManual('') }}><option value="">Selecionar pelo nome</option>{deputies.map((deputy) => <option key={deputy.id} value={deputy.id}>{deputy.nome}{deputy.uf ? ` · ${deputy.uf}` : ''}</option>)}</select></div>
			<TextField label="Deputado responsável (nome)" value={deputadoNomeManual} onChange={(value) => { setDeputadoNomeManual(value); setDeputadoId('') }} placeholder="Informe o nome manualmente" />
			<div className="field"><label htmlFor="baixa-amendment">Emenda estadual vinculada</label><select id="baixa-amendment" value={emendaId} onChange={(event) => setEmendaId(event.target.value)}><option value="">Nenhuma</option>{emendas.map((emenda) => <option key={emenda.id} value={emenda.id}>{emenda.uf} · {emenda.identificacao}</option>)}</select></div>
			<TextField label="Data efetiva do pagamento" value={paymentDate} onChange={setPaymentDate} type="date" /><div className="field"><label htmlFor="baixa-status">Status da baixa</label><select id="baixa-status" value={status} onChange={(event) => setStatus(event.target.value as BaixaStatus)}>{baixaStatuses.map((item) => <option key={item}>{item}</option>)}</select></div>
			<TextField label="Comprovante ou referência documental" value={documentReference} onChange={setDocumentReference} /><ReadOnly label="Data de criação do registro" value={existing ? formatDate(existing.createdAt) : 'Definida ao salvar'} />
			<ReadOnly label="Última atualização" value={existing ? formatDate(existing.updatedAt) : 'Definida ao salvar'} />
			<div className="field form-span-2"><label htmlFor="baixa-description">Descrição ou observação{status === 'Cancelado' ? ' (motivo obrigatório)' : amount > repasse.netAmount ? ' (justificativa obrigatória)' : ''}</label><textarea id="baixa-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Observações, justificativas ou motivo do cancelamento" /></div>
		</div>{error && <div role="alert" className="notice notice-error" style={{ marginTop: 15 }}>{error}</div>}<div className="form-footer">{existing && <button className="button button-danger" type="button" onClick={remove}>Excluir registro</button>}<Link to="/baixas" className="button">Cancelar</Link><button className="button button-primary" type="submit"><Save size={14} /> Salvar baixa</button></div></section>
		<aside className="side-summary"><section className="form-card"><h3>Resumo do repasse demonstrativo</h3><Summary label="Período" value={`${String(repasse.month).padStart(2, '0')}/${repasse.year}`} /><Summary label="Processo" value={repasse.processNumber} /><Summary label="Ordem bancária" value={repasse.bankOrderNumber ?? '—'} /><Summary label="Data da OB" value={formatDate(repasse.bankOrderDate)} /><Summary label="Valor líquido" value={formatCurrency(repasse.netAmount)} /><Summary label="Saldo restante" value={formatCurrency(balance)} /></section><div className="notice">A baixa está no Supabase, mas este vínculo aponta para dados demonstrativos, não para um repasse oficial importado.</div></aside></div></form>
	</div>
}

function ReadOnly({ label, value }: { label: string; value: string }) { return <div className="field"><span className="field-label">{label}</span><div className="readonly-value">{value}</div></div> }
function TextField({ label, value, onChange, type = 'text', min, step, required, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; min?: string; step?: string; required?: boolean; placeholder?: string }) { const id = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'); return <div className="field"><label htmlFor={id}>{label}{required && ' *'}</label><input id={id} type={type} value={value} min={min} step={step} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></div> }
function Summary({ label, value }: { label: string; value: string }) { return <div className="summary-row"><span>{label}</span><strong>{value}</strong></div> }
