import { useState, type ReactNode } from 'react'

const PASSCODE = import.meta.env.VITE_ADMIN_PASSCODE as string | undefined

/** Client-side passcode gate. Weak by design (passcode ships in the bundle) — internal MVP only. */
export function AdminGate({ label, children }: { label: string; children: ReactNode }) {
  const [ok, setOk] = useState(() => sessionStorage.getItem('admin_ok') === '1')
  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  if (ok) return <>{children}</>

  const submit = () => {
    if (!PASSCODE) return setError('VITE_ADMIN_PASSCODE is not set. Add it in Vercel env vars and redeploy.')
    if (input === PASSCODE) {
      sessionStorage.setItem('admin_ok', '1')
      setOk(true)
    } else setError('Wrong passcode.')
  }

  return (
    <div className="gate-wrap">
      <div className="gate-card">
        <h1 className="gate-title">{label}</h1>
        <input
          className="vote-input" type="password" value={input} autoFocus placeholder="Passcode"
          onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {error && <p className="vote-error">{error}</p>}
        <button className="vote-btn primary" onClick={submit}>Enter</button>
      </div>
    </div>
  )
}
