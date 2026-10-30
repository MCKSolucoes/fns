import type { EmendaEstadual } from '../types'

export const estadosBrasileiros = [
	'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
	'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

export function validateEmenda(emenda: EmendaEstadual, emendas: EmendaEstadual[]): string {
	if (!estadosBrasileiros.includes(emenda.uf)) return 'Selecione uma UF brasileira válida.'
	if (!emenda.identificacao.trim()) return 'Informe a identificação ou o número da emenda.'
	if (emenda.identificacao.trim().length > 120) return 'A identificação da emenda deve ter no máximo 120 caracteres.'
	if (!Number.isFinite(emenda.valor) || emenda.valor <= 0) return 'Informe um valor em reais maior que zero.'
	if (!emenda.objeto.trim()) return 'Informe o objeto ou a finalidade da emenda.'
	if (emenda.objeto.trim().length > 180) return 'O objeto deve ter no máximo 180 caracteres.'
	if ((emenda.observacoes?.trim().length ?? 0) > 1000) return 'As observações devem ter no máximo 1.000 caracteres.'
	const duplicate = emendas.some((item) =>
		item.id !== emenda.id
		&& item.uf === emenda.uf
		&& item.identificacao.trim().toLocaleLowerCase('pt-BR') === emenda.identificacao.trim().toLocaleLowerCase('pt-BR'),
	)
	if (duplicate) return 'Já existe uma emenda cadastrada com essa identificação nesta UF.'
	return ''
}
