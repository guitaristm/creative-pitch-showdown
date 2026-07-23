import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AudienceView from './routes/AudienceView.tsx'
import OperatorView from './routes/OperatorView.tsx'
import VoteView from './routes/VoteView.tsx'
import AdminView from './routes/AdminView.tsx'
import VotingDashboard from './routes/VotingDashboard.tsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/audience" element={<AudienceView />} />
        <Route path="/operator" element={<OperatorView />} />
        <Route path="/vote" element={<VoteView />} />
        <Route path="/dashboard" element={<VotingDashboard />} />
        <Route path="/admin" element={<AdminView />} />
        <Route path="*" element={<Navigate to="/audience" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
