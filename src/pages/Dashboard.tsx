import { useMemo } from 'react'
import { ArrowDownToLine, Banknote, CheckCircle2, Clock3, FileText, Search, Wallet } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'
import { useAppData } from '../hooks/useAppData'
import StatusBadge from '../components/StatusBadge'
import { formatCurrency, formatDate, monthName } from '../utils/formatters'
import type { BaixaStatus } from '../types'

const chartColors = ['#709e6c', '#d9ad54', '#648eaa', '#cf837c', '#a2b48d']
const currentDate = new Date()

export default function Dashboard() {
	const { baixas, repasses, repassesLoading, repassesError, dataLoading, dataError, reload } = useAppData()
	const chartData = useMemo(() => {
		const items = repasses.map((repasse) => ({
			repasse,
			baixa: baixas.find((item) => repasse.storageId
				? item.repasseId === repasse.storageId
				: !item.repasseId && item.transferId === repasse.id),
		}))
		const valuedItems = items.filter(({ repasse }) => repasse.hasOfficialNetAmount === true)
		const linkedBaixas = items.flatMap(({ baixa }) => baixa ? [baixa] : [])
		const now = currentDate
		const monthly = Array.from({ length: 8 }, (_, index) => {
			const period = new Date(now.getFullYear(), now.getMonth() - 7 + index, 1)
			const year = period.getFullYear()
			const month = period.getMonth() + 1
			const group = valuedItems.filter(({ repasse }) => repasse.year === year && repasse.month === month)
			const paidInMonth = linkedBaixas
				.filter((baixa) => baixa.status !== 'Cancelado' && baixa.paymentDate?.startsWith(`${year}-${String(month).padStart(2, '0')}`))
				.reduce((sum, baixa) => sum + baixa.paidAmount, 0)
			return {
				month: monthName(month, true),
				Pago: paidInMonth,
				Pendente: group.reduce((sum, item) => sum + (item.baixa?.status === 'Cancelado'
					? 0
					: Math.max(item.repasse.netAmount - (item.baixa?.paidAmount ?? 0), 0)), 0),
			}
		})
		const statusList: BaixaStatus[] = ['Pendente', 'Em processamento', 'Pago', 'Pago parcialmente', 'Cancelado']
		const statuses = statusList
			.map((status) => ({ name: status, value: items.filter(({ baixa }) => (baixa?.status ?? 'Pendente') === status).length }))
			.filter((item) => item.value)
		const totals = valuedItems.reduce((sum, item) => ({
			registered: sum.registered + item.repasse.netAmount,
			paid: sum.paid + (item.baixa?.status === 'Cancelado' ? 0 : item.baixa?.paidAmount ?? 0),
			pending: sum.pending + (item.baixa?.status === 'Cancelado'
				? 0
				: Math.max(item.repasse.netAmount - (item.baixa?.paidAmount ?? 0), 0)),
		}), { registered: 0, paid: 0, pending: 0 })
		const paidThisMonth = linkedBaixas
			.filter((baixa) => baixa.paymentDate?.slice(0, 7) === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` && baixa.status !== 'Cancelado')
			.reduce((sum, baixa) => sum + baixa.paidAmount, 0)
		const datedItems = items.filter(({ repasse }) => Boolean(repasse.dueDate))
		const overdue = datedItems.filter(({ repasse, baixa }) =>
			repasse.dueDate! < now.toISOString().slice(0, 10)
			&& !['Pago', 'Cancelado'].includes(baixa?.status ?? 'Pendente'),
		).length
		const missingMunicipalityCodes = items.filter(({ repasse }) => !/^\d{7}$/.test(repasse.municipalityIbge ?? '')).length
		return {
			items,
			monthly,
			statuses,
			totals,
			paidThisMonth,
			overdue,
			valuedCount: valuedItems.length,
			missingAmountCount: items.length - valuedItems.length,
			missingMunicipalityCodes,
			hasDueDates: datedItems.length > 0,
		}
	}, [baixas, repasses])
	const pending = chartData.items.filter(({ baixa }) =>
		!baixa || ['Pendente', 'Em processamento', 'Pago parcialmente'].includes(baixa.status),
	).length
	const linkedBaixas = chartData.items.flatMap(({ baixa, repasse }) => baixa ? [{ baixa, repasse }] : [])
	const paidCount = linkedBaixas.filter(({ baixa }) => baixa.status === 'Pago').length
	const latest = [...linkedBaixas].sort((a, b) => b.baixa.updatedAt.localeCompare(a.baixa.updatedAt)).slice(0, 5)
	const dashboardReady = !repassesLoading && !repassesError && repasses.length > 0
	const internalDataReady = !dataLoading && !dataError

	return <div className="page-content">
		<div className="page-heading"><div><h2>Visão geral</h2><p>Acompanhe os repasses oficiais importados e os controles internos vinculados.</p></div><Link to="/consultas" className="button button-primary"><Search size={15} /> Consultar repasses</Link></div>
		{repassesLoading && <div className="notice" role="status">Carregando repasses oficiais do Supabase…</div>}
		{repassesError && <div className="notice notice-error" role="alert">{repassesError}</div>}
		{!repassesLoading && !repassesError && repasses.length === 0 && <div className="notice notice-blue"><FileText size={15} /> Nenhum repasse oficial foi importado. Acesse Consultas FNS, selecione os registros e confirme a importação.</div>}
		{dashboardReady && <>
			{chartData.missingAmountCount > 0 && <div className="notice notice-amber" role="status">{chartData.missingAmountCount} repasse(s) não possuem valor líquido oficial; os totais financeiros consideram apenas os {chartData.valuedCount} registro(s) com valor disponível.</div>}
			{chartData.missingMunicipalityCodes > 0 && <div className="notice notice-amber" role="status">{chartData.missingMunicipalityCodes} repasse(s) não possuem código IBGE válido; não é possível relacioná-los com segurança a um município.</div>}
			{dataError && <div className="notice notice-amber" role="alert">Os repasses oficiais foram carregados, mas os indicadores de baixas internas estão indisponíveis: {dataError} <button className="text-action" onClick={() => void reload().catch(() => {})}>Tentar novamente</button></div>}
			<div className="metric-grid">
				<Metric label="Repasses importados" value={String(repasses.length)} foot="Registros oficiais no Supabase" icon={<FileText size={16} />} />
				<Metric label="Pendentes de baixa" value={internalDataReady ? String(pending) : '—'} foot="Inclui repasses parcialmente pagos" icon={<Clock3 size={16} />} />
				<Metric label="Pagamentos concluídos" value={internalDataReady ? String(paidCount) : '—'} foot="Baixas vinculadas a repasses oficiais" icon={<CheckCircle2 size={16} />} />
				<Metric label="Em atraso" value={internalDataReady && chartData.hasDueDates ? String(chartData.overdue) : '—'} foot={chartData.hasDueDates ? 'Somente com vencimento informado' : 'Data de vencimento indisponível'} icon={<ArrowDownToLine size={16} />} />
				<Metric label="Total financeiro registrado" value={chartData.valuedCount ? formatCurrency(chartData.totals.registered) : '—'} foot={`${chartData.valuedCount} repasse(s) com valor líquido oficial`} icon={<Banknote size={16} />} />
				<Metric label="Total pago no mês" value={internalDataReady ? formatCurrency(chartData.paidThisMonth) : '—'} foot="Baixas vinculadas com data efetiva" icon={<CheckCircle2 size={16} />} />
				<Metric label="Total pendente" value={internalDataReady && chartData.valuedCount ? formatCurrency(chartData.totals.pending) : '—'} foot="Saldo dos repasses com valor disponível" icon={<Wallet size={16} />} />
			</div>
			<div className="dashboard-grid">
				<section className="panel"><div className="panel-heading"><h3>Pagamentos por mês</h3><span>Dados persistidos no Supabase</span></div>{!internalDataReady ? <div className="empty-state">Dados das baixas indisponíveis; os valores pagos e pendentes não podem ser calculados.</div> : chartData.valuedCount ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData.monthly} margin={{ top: 8, right: 8, left: 3, bottom: 0 }}><CartesianGrid stroke="#edf0ec" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 10, fill: '#78847a' }} axisLine={false} tickLine={false} /><YAxis tickFormatter={(value) => `${Math.round(value / 1000)} mil`} tick={{ fontSize: 10, fill: '#78847a' }} axisLine={false} tickLine={false} width={46} /><Tooltip formatter={(value) => formatCurrency(Number(value))} /><Area type="monotone" dataKey="Pago" stroke="#709e6c" fill="#dfead9" strokeWidth={2} /><Area type="monotone" dataKey="Pendente" stroke="#d4a447" fill="#faf0d8" strokeWidth={2} /></AreaChart></ResponsiveContainer></div> : <div className="empty-state">Valores líquidos oficiais indisponíveis para os repasses importados.</div>}</section>
				<section className="panel"><div className="panel-heading"><h3>Repasses por status</h3><span>{repasses.length} repasses</span></div>{!internalDataReady ? <div className="empty-state">O status depende das baixas internas, que não estão disponíveis.</div> : <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chartData.statuses} dataKey="value" nameKey="name" innerRadius={55} outerRadius={82} paddingAngle={3}>{chartData.statuses.map((item, index) => <Cell key={item.name} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip /><Legend data={chartData.statuses} /></PieChart></ResponsiveContainer></div>}</section>
			</div>
			<section className="panel" style={{ marginBottom: 15 }}><div className="panel-heading"><h3>Comparativo de valores</h3><span>Repasses oficiais importados</span></div>{!internalDataReady ? <div className="empty-state">Valores pagos e pendentes indisponíveis sem as baixas internas.</div> : chartData.valuedCount ? <div className="chart-wrap compare-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ name: 'Valores registrados', Pago: chartData.totals.paid, Pendente: chartData.totals.pending }]} layout="vertical" margin={{ left: 8, right: 20 }}><CartesianGrid stroke="#edf0ec" horizontal={false} /><XAxis type="number" tickFormatter={(value) => `${Math.round(value / 1000)} mil`} tick={{ fontSize: 10, fill: '#78847a' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: '#78847a' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => formatCurrency(Number(value))} /><Bar dataKey="Pago" fill="#709e6c" radius={[0, 4, 4, 0]} /><Bar dataKey="Pendente" fill="#e3c16c" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div> : <div className="empty-state">Valores financeiros oficiais indisponíveis.</div>}</section>
			<div className="section-title">Últimas baixas vinculadas a repasses importados</div>
			<section className="table-panel"><div className="table-scroll"><table><thead><tr><th>Repasse</th><th>Beneficiário</th><th>Valor pago</th><th>Data efetiva</th><th>Status</th><th>Atualizado</th></tr></thead><tbody>{latest.length ? latest.map(({ baixa, repasse }) => <tr key={baixa.id}><td><span className="primary-cell">{`${String(repasse.month).padStart(2, '0')}/${repasse.year}`}</span><div className="secondary-cell">{repasse.processNumber}</div></td><td>{baixa.beneficiary}</td><td>{formatCurrency(baixa.paidAmount)}</td><td>{formatDate(baixa.paymentDate)}</td><td><StatusBadge status={baixa.status} /></td><td>{formatDate(baixa.updatedAt.slice(0, 10))}</td></tr>) : <tr><td colSpan={6} className="empty-state">{internalDataReady ? 'Nenhuma baixa vinculada a repasses importados.' : 'Não foi possível carregar as baixas internas.'}</td></tr>}</tbody></table></div><div className="pagination"><span>{internalDataReady ? `Mostrando ${latest.length} registros recentes` : 'Dados de baixas indisponíveis'}</span><Link to="/repasses-importados" className="text-action">Ver repasses importados →</Link></div></section>
		</>}
	</div>
}

function Metric({ label, value, foot, icon }: { label: string; value: string; foot: string; icon: React.ReactNode }) { return <div className="metric"><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{value}</div><div className="metric-foot">{foot}</div></div> }
function Legend({ data }: { data: { name: string; value: number }[] }) { return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px', padding: '0 8px', fontSize: 10 }}>{data.map((item, index) => <span key={item.name} style={{ color: '#68756b' }}><span style={{ color: chartColors[index % chartColors.length], marginRight: 5 }}>●</span>{item.name} ({item.value})</span>)}</div> }
