import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { FeedbackProvider } from './components/FeedbackProvider'
import { AuthProvider } from './services/authSession'
import { BackendSessionProvider } from './services/backendSession'
import { AppDataProvider } from './services/baixasService'
import RequireAuth from './components/RequireAuth'
import AppLayout from './layouts/AppLayout'

const BaixaForm = lazy(() => import('./pages/BaixaForm'))
const Baixas = lazy(() => import('./pages/Baixas'))
const ComparacaoParcelas = lazy(() => import('./pages/ComparacaoParcelas'))
const Consultas = lazy(() => import('./pages/Consultas'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Deputados = lazy(() => import('./pages/Deputados'))
const EmendasEstaduais = lazy(() => import('./pages/EmendasEstaduais'))
const Historico = lazy(() => import('./pages/Historico'))
const RepassesImportados = lazy(() => import('./pages/RepassesImportados'))
const MigracaoDados = lazy(() => import('./pages/MigracaoDados'))
import './styles.css'

function App() {
  return (
    <FeedbackProvider>
      <AuthProvider>
        <BackendSessionProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </BackendSessionProvider>
      </AuthProvider>
    </FeedbackProvider>
  )
}

function AppRoutes() {
  return (
    <RequireAuth>
      <AppDataProvider>
        <Suspense fallback={<div className="page-content" role="status">Carregando página…</div>}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="consultas" element={<Consultas />} />
              <Route path="repasses-importados" element={<RepassesImportados />} />
              <Route path="migracao-dados" element={<MigracaoDados />} />
              <Route path="emendas-estaduais" element={<EmendasEstaduais />} />
              <Route path="deputados" element={<Deputados />} />
              <Route path="baixas" element={<Baixas />} />
              <Route path="comparacao-parcelas" element={<ComparacaoParcelas />} />
              <Route path="baixas/:id" element={<BaixaForm />} />
              <Route path="historico" element={<Historico />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </AppDataProvider>
    </RequireAuth>
  )
}

export default App
