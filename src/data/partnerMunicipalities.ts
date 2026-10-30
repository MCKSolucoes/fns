export interface PartnerMunicipality {
	readonly name: string
	readonly uf: 'MG' | 'RS' | 'SP'
	readonly ibgeCode: string
	readonly active: boolean
}

export const partnerMunicipalities: readonly PartnerMunicipality[] = [
	{ name: 'Aiuruoca', uf: 'MG', ibgeCode: '3101201', active: true },
	{ name: 'Carneirinho', uf: 'MG', ibgeCode: '3114550', active: true },
	{ name: 'Carvalhos', uf: 'MG', ibgeCode: '3114808', active: true },
	{ name: 'Iturama', uf: 'MG', ibgeCode: '3134400', active: true },
	{ name: 'Limeira do Oeste', uf: 'MG', ibgeCode: '3138625', active: true },
	{ name: 'São Francisco de Sales', uf: 'MG', ibgeCode: '3161304', active: true },
	{ name: 'Seritinga', uf: 'MG', ibgeCode: '3166402', active: true },
	{ name: 'Serranos', uf: 'MG', ibgeCode: '3167004', active: true },
	{ name: 'União de Minas', uf: 'MG', ibgeCode: '3170438', active: true },
	{ name: 'Santa Maria do Herval', uf: 'RS', ibgeCode: '4316956', active: true },
	{ name: 'Alfredo Marcondes', uf: 'SP', ibgeCode: '3500808', active: true },
	{ name: 'Álvares Florence', uf: 'SP', ibgeCode: '3501202', active: true },
	{ name: 'Álvares Machado', uf: 'SP', ibgeCode: '3501301', active: true },
	{ name: 'Apiaí', uf: 'SP', ibgeCode: '3502705', active: true },
	{ name: 'Emilianópolis', uf: 'SP', ibgeCode: '3515129', active: true },
	{ name: 'Flora Rica', uf: 'SP', ibgeCode: '3515806', active: true },
	{ name: 'Franca', uf: 'SP', ibgeCode: '3516200', active: true },
	{ name: 'Indiana', uf: 'SP', ibgeCode: '3520608', active: true },
	{ name: 'Itaoca', uf: 'SP', ibgeCode: '3522158', active: true },
	{ name: 'Junqueirópolis', uf: 'SP', ibgeCode: '3526001', active: true },
	{ name: 'Mirante do Paranapanema', uf: 'SP', ibgeCode: '3530201', active: true },
	{ name: 'Ouro Verde', uf: 'SP', ibgeCode: '3534807', active: true },
	{ name: 'Piquerobi', uf: 'SP', ibgeCode: '3538303', active: true },
	{ name: 'Regente Feijó', uf: 'SP', ibgeCode: '3542404', active: true },
	{ name: 'Ribeira', uf: 'SP', ibgeCode: '3542800', active: true },
	{ name: 'Riolândia', uf: 'SP', ibgeCode: '3544202', active: true },
	{ name: 'Santa Mercedes', uf: 'SP', ibgeCode: '3547106', active: true },
	{ name: 'Santo Anastácio', uf: 'SP', ibgeCode: '3547700', active: true },
	{ name: 'Santo Expedito', uf: 'SP', ibgeCode: '3548302', active: true },
	{ name: 'Taciba', uf: 'SP', ibgeCode: '3552908', active: true },
	{ name: 'Tupi Paulista', uf: 'SP', ibgeCode: '3555109', active: true },
]

export const partnerStates = [
	{ uf: 'MG', ibgeCode: '31', name: 'Minas Gerais' },
	{ uf: 'RS', ibgeCode: '43', name: 'Rio Grande do Sul' },
	{ uf: 'SP', ibgeCode: '35', name: 'São Paulo' },
] as const

export function getActivePartnerMunicipality(ibgeCode: string, uf?: string): PartnerMunicipality | undefined {
	return partnerMunicipalities.find((municipality) =>
		municipality.active
		&& municipality.ibgeCode === ibgeCode
		&& (!uf || municipality.uf === uf.toUpperCase()),
	)
}

export function getActivePartnerMunicipalities(uf?: string): readonly PartnerMunicipality[] {
	return partnerMunicipalities.filter((municipality) =>
		municipality.active && (!uf || municipality.uf === uf.toUpperCase()),
	)
}
