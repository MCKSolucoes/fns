import { useEffect, useState } from 'react'
import { fnsResourcesService, FnsResourceError } from '../services/fnsResourcesService'
import type { AnoOption, BlocoOption, MesOption, RepasseOption, TipoConsultaOption } from '../types/fnsResources'

export interface ResourceState<T> {
  items: T[]
  loading: boolean
  error: string
  stale: boolean
  retryable: boolean
}

const emptyResource = <T,>(): ResourceState<T> => ({ items: [], loading: false, error: '', stale: false, retryable: false })
const loadingResource = <T,>(previous?: ResourceState<T>): ResourceState<T> => ({
  items: previous?.items ?? [],
  loading: true,
  error: '',
  stale: previous?.stale ?? false,
  retryable: false,
})

function errorMessage(error: unknown) {
  if (error instanceof FnsResourceError) return error.message
  if (error instanceof TypeError) return 'Não foi possível conectar à API FNS. Verifique se o backend está em execução e tente novamente.'
  return error instanceof Error ? error.message : 'Não foi possível carregar este recurso da API FNS.'
}

function failedResource<T>(previous: ResourceState<T>, error: unknown): ResourceState<T> {
  const cachedItems = error instanceof FnsResourceError ? error.cachedItems as T[] | undefined : undefined
  const items = previous.items.length ? previous.items : cachedItems ?? []
  return {
    items,
    loading: false,
    error: errorMessage(error),
    stale: items.length > 0,
    retryable: error instanceof FnsResourceError && error.retryable,
  }
}

export function useFnsResources(year: string, queryType: string) {
  const [years, setYears] = useState<ResourceState<AnoOption>>(() => loadingResource())
  const [months, setMonths] = useState<ResourceState<MesOption>>(() => loadingResource())
  const [transferTypes, setTransferTypes] = useState<ResourceState<RepasseOption>>(() => loadingResource())
  const [blocksState, setBlocksState] = useState<{ key: string; resource: ResourceState<BlocoOption> }>(() => ({ key: '', resource: emptyResource() }))
  const [consultationTypesState, setConsultationTypesState] = useState<{ year: string; resource: ResourceState<TipoConsultaOption> }>(() => ({ year: '', resource: emptyResource() }))
  const [yearsAttempt, setYearsAttempt] = useState(0)
  const [monthsAttempt, setMonthsAttempt] = useState(0)
  const [transferTypesAttempt, setTransferTypesAttempt] = useState(0)
  const [blocksAttempt, setBlocksAttempt] = useState(0)
  const [consultationTypesAttempt, setConsultationTypesAttempt] = useState(0)
  const consultationTypes = !year
    ? emptyResource<TipoConsultaOption>()
    : consultationTypesState.year === year ? consultationTypesState.resource : loadingResource<TipoConsultaOption>()
  const selectedTypeAvailable = !consultationTypes.loading
    && (!consultationTypes.error || consultationTypes.stale)
    && consultationTypes.items.some((item) => String(item.valor) === queryType)

  useEffect(() => {
    let active = true
    fnsResourcesService.getAnos(yearsAttempt > 0).then((items) => {
      if (active) setYears({ items, loading: false, error: '', stale: false, retryable: false })
    }).catch((error: unknown) => {
      if (active) setYears((current) => failedResource(current, error))
    })
    return () => { active = false }
  }, [yearsAttempt])

  useEffect(() => {
    let active = true
    fnsResourcesService.getMeses(monthsAttempt > 0).then((items) => {
      if (active) setMonths({ items, loading: false, error: '', stale: false, retryable: false })
    }).catch((error: unknown) => {
      if (active) setMonths((current) => failedResource(current, error))
    })
    return () => { active = false }
  }, [monthsAttempt])

  useEffect(() => {
    let active = true
    fnsResourcesService.getRepasses(transferTypesAttempt > 0).then((items) => {
      if (active) setTransferTypes({ items, loading: false, error: '', stale: false, retryable: false })
    }).catch((error: unknown) => {
      if (active) setTransferTypes((current) => failedResource(current, error))
    })
    return () => { active = false }
  }, [transferTypesAttempt])

  useEffect(() => {
    let active = true
    if (!year || !queryType || !selectedTypeAvailable) {
      return () => { active = false }
    }
    const key = `${year}:${queryType}`
    fnsResourcesService.getBlocos(year, queryType, blocksAttempt > 0).then((items) => {
      if (active) setBlocksState({ key, resource: { items, loading: false, error: '', stale: false, retryable: false } })
    }).catch((error: unknown) => {
      if (active) setBlocksState((current) => ({
        key,
        resource: failedResource(current.key === key ? current.resource : emptyResource<BlocoOption>(), error),
      }))
    })
    return () => { active = false }
  }, [year, queryType, selectedTypeAvailable, blocksAttempt])

  useEffect(() => {
    let active = true
    if (!year) return () => { active = false }
    fnsResourcesService.getTiposConsulta(year, consultationTypesAttempt > 0).then((items) => {
      if (active) setConsultationTypesState({ year, resource: { items, loading: false, error: '', stale: false, retryable: false } })
    }).catch((error: unknown) => {
      if (active) setConsultationTypesState((current) => ({
        year,
        resource: failedResource(current.year === year ? current.resource : emptyResource<TipoConsultaOption>(), error),
      }))
    })
    return () => { active = false }
  }, [year, consultationTypesAttempt])

  const blocksKey = `${year}:${queryType}`
  const blocks = !year || !queryType || !selectedTypeAvailable
    ? emptyResource<BlocoOption>()
    : blocksState.key === blocksKey ? blocksState.resource : loadingResource<BlocoOption>()

  const retryYears = () => { setYears((current) => loadingResource(current)); setYearsAttempt((attempt) => attempt + 1) }
  const retryMonths = () => { setMonths((current) => loadingResource(current)); setMonthsAttempt((attempt) => attempt + 1) }
  const retryTransferTypes = () => { setTransferTypes((current) => loadingResource(current)); setTransferTypesAttempt((attempt) => attempt + 1) }
  const retryBlocks = () => { setBlocksState((current) => ({ key: blocksKey, resource: loadingResource(current.key === blocksKey ? current.resource : undefined) })); setBlocksAttempt((attempt) => attempt + 1) }
  const retryConsultationTypes = () => { setConsultationTypesState((current) => ({ year, resource: loadingResource(current.year === year ? current.resource : undefined) })); setConsultationTypesAttempt((attempt) => attempt + 1) }

  return {
    years,
    months,
    transferTypes,
    blocks,
    consultationTypes,
    retryYears,
    retryMonths,
    retryTransferTypes,
    retryBlocks,
    retryConsultationTypes,
  }
}