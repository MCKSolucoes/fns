import { useMemo, useState, type FormEvent } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useAppData } from '../hooks/useAppData'
import type { EmendaEstadual } from '../types'
import { formatCurrency, formatCurrencyInput, normalized, parseCurrencyInput } from '../utils/formatters'
import { estadosBrasileiros, validateEmenda } from '../utils/validateEmenda'

export default function EmendasEstaduais() {
	const { emendas, saveEmenda, deleteEmenda, dataLoading, dataError, persistenceMode } = useAppData()
	const canWrite = persistenceMode === 'supabase'
	const [form, setForm] = useState<EmendaEstadual | null>(null)
	const [query, setQuery] = useState('')
	const [saved, setSaved] = useState(false)
	const [error, setError] = useState('')
	const rows = useMemo(() => emendas.filter((emenda) =>
		normalized(`${emenda.uf} ${emenda.identificacao} ${emenda.objeto} ${emenda.observacoes ?? ''}`).includes(normalized(query)),
	), [emendas, query])
	const openNew = () => {
		setSaved(false)
		setForm({ id: crypto.randomUUID(), uf: '', identificacao: '', valor: 0, objeto: '' })
	}
	const remove = (emenda: EmendaEstadual) => {
		if (window.confirm(`Excluir a emenda ${emenda.uf} · ${emenda.identificacao}?`)) {
			void deleteEmenda(emenda).then(() => setError('')).catch((deleteError: unknown) => {
				setError(deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir a emenda no Supabase.')
			})
		}
	}
	const submitEmenda = async (emenda: EmendaEstadual) => {
		try {
			await saveEmenda(emenda)
			setForm(null)
			setSaved(true)
			setError('')
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar a emenda no Supabase.')
		}
	}

	return <div className="page-content">
		<div className="page-heading">
			<div><h2>Emendas Estaduais</h2><p>Cadastros internos, separados dos dados oficiais consultados no FNS.</p></div>
			<button className="button button-primary" disabled={!canWrite} onClick={openNew}><Plus size={15} /> Nova emenda</button>
		</div>
		{dataError && <div role="alert" className="notice notice-error">{dataError}</div>}
		{error && <div role="alert" className="notice notice-error">{error}</div>}
		{saved && <div role="status" className="notice" style={{ marginBottom: 14 }}>Emenda salva no Supabase.</div>}
		{form && <EmendaForm
			key={form.id}
			emenda={form}
			emendas={emendas}
			onCancel={() => setForm(null)}
			onSave={submitEmenda}
			canWrite={canWrite}
		/>}
		<section className="filter-panel">
			<div className="emenda-summary"><strong>{rows.length} emenda(s)</strong><span>Valor cadastrado: {formatCurrency(rows.reduce((total, item) => total + item.valor, 0))}</span></div>
			<div className="field emenda-search"><label htmlFor="emenda-search">Buscar emendas</label><input id="emenda-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="UF, número ou finalidade" /></div>
		</section>
		<section className="table-panel">
			<div className="table-toolbar"><strong>Emendas cadastradas</strong><span>{rows.length} registro(s)</span></div>
			{dataLoading ? <div role="status" className="empty-state">Carregando emendas…</div> : rows.length ? <div className="table-scroll"><table><thead><tr><th>UF</th><th>Identificação</th><th>Objeto/finalidade</th><th>Valor</th><th>Observações</th><th>Ações</th></tr></thead><tbody>
				{rows.map((emenda) => <tr key={emenda.id}><td>{emenda.uf}</td><td className="primary-cell">{emenda.identificacao}</td><td>{emenda.objeto}</td><td>{formatCurrency(emenda.valor)}</td><td>{emenda.observacoes || '—'}</td><td><div className="table-actions">
					<button className="text-action" title="Editar emenda" aria-label={`Editar emenda ${emenda.identificacao}`} disabled={!canWrite} onClick={() => { setSaved(false); setForm({ ...emenda })}}><Pencil size={15} /></button>
					<button className="text-action" title="Excluir emenda" aria-label={`Excluir emenda ${emenda.identificacao}`} disabled={!canWrite} onClick={() => remove(emenda)}><Trash2 size={15} /></button>
				</div></td></tr>)}
			</tbody></table></div> : <div className="empty-state"><strong>{query ? 'Nenhuma emenda encontrada' : 'Nenhuma emenda cadastrada'}</strong><span>{query ? 'Tente outra identificação, UF ou finalidade.' : 'Use “Nova emenda” para iniciar o cadastro.'}</span></div>}
		</section>
	</div>
}

function EmendaForm({ emenda, emendas, onCancel, onSave, canWrite }: {
	emenda: EmendaEstadual
	emendas: EmendaEstadual[]
	onCancel: () => void
	onSave: (emenda: EmendaEstadual) => Promise<void>
	canWrite: boolean
}) {
	const [uf, setUf] = useState(emenda.uf)
	const [identificacao, setIdentificacao] = useState(emenda.identificacao)
	const [valor, setValor] = useState(emenda.valor > 0 ? formatCurrency(emenda.valor) : '')
	const [objeto, setObjeto] = useState(emenda.objeto)
	const [observacoes, setObservacoes] = useState(emenda.observacoes ?? '')
	const [error, setError] = useState('')
	const save = async (event: FormEvent) => {
		event.preventDefault()
		const draft: EmendaEstadual = {
			id: emenda.id,
			uf,
			identificacao: identificacao.trim(),
			valor: parseCurrencyInput(valor),
			objeto: objeto.trim(),
			...(observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
		}
		const validation = validateEmenda(draft, emendas)
		if (validation) { setError(validation); return }
		await onSave(draft)
	}

	return <form className="form-card emenda-form" onSubmit={save}>
		<div className="emenda-form-heading"><h3>{emendas.some((item) => item.id === emenda.id) ? 'Editar emenda' : 'Cadastrar emenda'}</h3><button className="button button-icon" type="button" aria-label="Fechar formulário" onClick={onCancel}><X size={15} /></button></div>
		<div className="form-grid">
			<div className="field"><label htmlFor="emenda-uf">Estado (UF) *</label><select id="emenda-uf" value={uf} required onChange={(event) => setUf(event.target.value)}><option value="">Selecione</option>{estadosBrasileiros.map((estado) => <option key={estado} value={estado}>{estado}</option>)}</select></div>
			<div className="field"><label htmlFor="emenda-identificacao">Identificação/número da emenda *</label><input id="emenda-identificacao" value={identificacao} maxLength={120} required onChange={(event) => setIdentificacao(event.target.value)} /></div>
			<div className="field"><label htmlFor="emenda-valor">Valor em reais *</label><input id="emenda-valor" inputMode="numeric" autoComplete="off" value={valor} placeholder="R$ 0,00" required onChange={(event) => setValor(formatCurrencyInput(event.target.value))} /></div>
			<div className="field"><label htmlFor="emenda-objeto">Objeto/finalidade *</label><input id="emenda-objeto" value={objeto} maxLength={180} placeholder="Custeio, climatização e outros" required onChange={(event) => setObjeto(event.target.value)} /></div>
			<div className="field form-span-2"><label htmlFor="emenda-observacoes">Observações (opcional)</label><textarea id="emenda-observacoes" value={observacoes} maxLength={1000} onChange={(event) => setObservacoes(event.target.value)} /></div>
		</div>
		{error && <div role="alert" className="notice notice-error" style={{ marginTop: 14 }}>{error}</div>}
		<div className="form-footer"><button className="button" type="button" onClick={onCancel}>Cancelar</button><button className="button button-primary" type="submit" disabled={!canWrite}>Salvar emenda</button></div>
	</form>
}
