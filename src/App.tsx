import { Routes, Route } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import ErrorBoundary from './components/ErrorBoundary'

// Eagerly loaded (critical path)
import Boot from './pages/Boot'
import Login from './pages/Login'
import NotFound from './pages/NotFound'

// Lazy-loaded pages for code splitting
const Hub = lazy(() => import('./pages/Hub'))
const CommandCenter = lazy(() => import('./pages/CommandCenter'))
const Nexus = lazy(() => import('./pages/Nexus'))
const Goldmine = lazy(() => import('./pages/Goldmine'))
const Sara = lazy(() => import('./pages/Sara'))
const Signals = lazy(() => import('./pages/Signals'))
const GapClaw = lazy(() => import('./pages/GapClaw'))
const Documents = lazy(() => import('./pages/Documents'))
const Jarvis = lazy(() => import('./pages/Jarvis'))
const Status = lazy(() => import('./pages/Status'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <div className="animate-pulse text-zinc-500">Loading…</div>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Boot />} />
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route path="/hub" element={<Hub />} />
            <Route path="/command-center" element={<CommandCenter />} />
            <Route path="/nexus" element={<Nexus />} />
            <Route path="/goldmine" element={<Goldmine />} />
            <Route path="/sara" element={<Sara />} />
            <Route path="/signals" element={<Signals />} />
            <Route path="/gapclaw" element={<GapClaw />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/jarvis" element={<Jarvis />} />
            <Route path="/status" element={<Status />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
