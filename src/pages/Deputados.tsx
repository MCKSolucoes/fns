import { useMemo, useState, type FormEvent } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useAppData } from '../hooks/useAppData'
import type { Deputado } from '../types'
import { estadosBrasileiros } from '../utils/validateEmenda'
import { normalized } from '../utils/formatters'

export default function Deputados() {
	const { deputies, saveDeputy, deleteDeputy, dataLoading, dataError, persistenceMode } = useAppData()
	const canWrite = persistenceMode === 'supabase'
	const [form, setForm] = useState<Deputado | null>(null)
	const [query, setQuery] = useState('')
	const [error, setError] = useState('')
	const [saved, setSaved] = useState(false)
	const rows = useMemo(() => deputies.filter((deputy) =>
		normalized(`${deputy.nome} ${deputy.partido ?? ''} ${deputy.uf ?? ''}`).includes(normalized(query)),
	), [deputies, query])

	const submit = async (event: FormEvent) => {
		event.preventDefault()
		if (!form) return
		const deputy = { ...form, nome: form.nome.trim(), partido: form.partido?.trim() || undefined, observacoes: form.observacoes?.trim() || undefined }
		if (!deputy.nome || deputy.nome.length > 180) {
			setError('Informe um nome com até 180 caracteres.')
			return
		}
		try {
			await saveDeputy(deputy)
			setForm(null)
			setError('')
			setSaved(true)
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o deputado no Supabase.')
		}
	}

	const remove = (deputy: Deputado) => {
		if (!window.confirm(`Excluir o cadastro de ${deputy.nome}?`)) return
		void deleteDeputy(deputy).then(() => setError('')).catch((deleteError: unknown) => {
			setError(deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir o deputado.')
		})
	}

	return <div className="page-content">
		<div className="page-heading"><div><h2>Deputados</h2><p>Cadastro manual para vincular aos registros internos. Não é obtido da API do FNS.</p></div>
			{canWrite && <button className="button button-primary" onClick={() => { setSaved(false); setForm({ id: crypto.randomUUID(), nome: '' }) }}><Plus size={15} /> Novo deputado</button>}
		</div>
		{dataError && <div role="alert" className="notice notice-error">{dataError}</div>}
		{error && <div role="alert" className="notice notice-error">{error}</div>}
		{saved && <div role="status" className="notice">Cadastro salvo no banco compartilhado.</div>}
		{!canWrite && <div className="notice notice-amber">Cadastro e edição estão desabilitados até a conexão com o Supabase de desenvolvimento estar ativa.</div>}
		{form && <form className="form-card emenda-form" onSubmit={(event) => void submit(event)}>
			<div className="emenda-form-heading"><h3>{deputies.some((item) => item.id === form.id) ? 'Editar deputado' : 'Cadastrar deputado'}</h3><button className="button button-icon" type="button" aria-label="Fechar formulário" onClick={() => setForm(null)}><X size={15} /></button></div>
			<div className="form-grid">
				<div className="field"><label htmlFor="deputy-name">Nome *</label><input id="deputy-name" required maxLength={180} value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} /></div>
				<div className="field"><label htmlFor="deputy-party">Partido</label><input id="deputy-party" maxLength={80} value={form.partido ?? ''} onChange={(event) => setForm({ ...form, partido: event.target.value })} /></div>
				<div className="field"><label htmlFor="deputy-uf">UF</label><select id="deputy-uf" value={form.uf ?? ''} onChange={(event) => setForm({ ...form, uf: event.target.value || undefined })}><option value="">Não informada</option>{estadosBrasileiros.map((uf) => <option key={uf}>{uf}</option>)}</select></div>
				<div className="field form-span-2"><label htmlFor="deputy-notes">Observações</label><textarea id="deputy-notes" maxLength={2000} value={form.observacoes ?? ''} onChange={(event) => setForm({ ...form, observacoes: event.target.value })} /></div>
			</div>
			<div className="form-footer"><button className="button" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="button button-primary" type="submit" disabled={!canWrite}>Salvar deputado</button></div>
		</form>}
		<section className="filter-panel"><div className="field emenda-search"><label htmlFor="deputy-search">Buscar deputados</label><input id="deputy-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, partido ou UF" /></div></section>
		<section className="table-panel"><div className="table-toolbar"><strong>Deputados cadastrados</strong><span>{rows.length} registro(s)</span></div>
			{dataLoading ? <div className="empty-state" role="status">Carregando deputados…</div> : rows.length ? <div className="table-scroll"><table><thead><tr><th>Nome</th><th>Partido</th><th>UF</th><th>Observações</th>{canWrite && <th>Ações</th>}</tr></thead><tbody>{rows.map((deputy) => <tr key={deputy.id}><td className="primary-cell">{deputy.nome}</td><td>{deputy.partido || '—'}</td><td>{deputy.uf || '—'}</td><td>{deputy.observacoes || '—'}</td>{canWrite && <td><div className="table-actions"><button className="text-action" title="Editar deputado" aria-label={`Editar ${deputy.nome}`} onClick={() => { setSaved(false); setForm({ ...deputy }) }}><Pencil size={15} /></button><button className="text-action" title="Excluir deputado" aria-label={`Excluir ${deputy.nome}`} onClick={() => remove(deputy)}><Trash2 size={15} /></button></div></td>}</tr>)}</tbody></table></div> : <div className="empty-state"><strong>Nenhum deputado cadastrado</strong><span>Cadastre o deputado manualmente para selecioná-lo nas baixas.</span></div>}
		</section>
	</div>
}
