import { useContext } from 'react'
import { AppDataContext } from '../services/appDataContext'

export function useAppData() {
  const value = useContext(AppDataContext)
  if (!value) throw new Error('useAppData deve ser usado dentro de AppDataProvider')
  return value
}