import type { MunicipioOption } from '../types/fnsResources.js'
import { getActivePartnerMunicipalities } from '../data/partnerMunicipalities.js'

export function normalizeMunicipalityName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR')
}

export function searchMunicipalities(items: MunicipioOption[], uf: string, query: string): MunicipioOption[] {
  const normalizedQuery = normalizeMunicipalityName(query)
  return items.filter((item) => item.sgUf === uf && normalizeMunicipalityName(item.noMunicipio).includes(normalizedQuery))
}

export function findMunicipalityByName(items: MunicipioOption[], uf: string, name: string): MunicipioOption | undefined {
  const normalizedName = normalizeMunicipalityName(name)
  return items.find((item) => item.sgUf === uf && normalizeMunicipalityName(item.noMunicipio) === normalizedName)
}

export function getConsultationMunicipalityCode(municipality: MunicipioOption): string {
  const partner = getActivePartnerMunicipalities(municipality.sgUf).find((item) => item.ibgeCode === municipality.id)
  if (!partner) throw new Error('Selecione um município parceiro ativo da lista autorizada.')
  return partner.ibgeCode
}
