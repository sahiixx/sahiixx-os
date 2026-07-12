import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import Boot from './pages/Boot'
import Hub from './pages/Hub'
import CommandCenter from './pages/CommandCenter'
import Nexus from './pages/Nexus'
import Goldmine from './pages/Goldmine'
import Sara from './pages/Sara'
import Signals from './pages/Signals'
import GapClaw from './pages/GapClaw'
import Jarvis from './pages/Jarvis'
import Login from './pages/Login'
import NotFound from './pages/NotFound'

export default function App() {
  return (
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
        <Route path="/jarvis" element={<Jarvis />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}