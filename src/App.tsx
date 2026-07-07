import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AudienceView from './routes/AudienceView.tsx'
import OperatorView from './routes/OperatorView.tsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/audience" element={<AudienceView />} />
        <Route path="/operator" element={<OperatorView />} />
        <Route path="*" element={<Navigate to="/audience" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
