import { useEffect, useState } from 'react'

export interface ToastMsg {
  kind: 'success' | 'error'
  text: string
}

export function useToast() {
  const [toast, setToast] = useState<ToastMsg | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])
  return { toast, notify: setToast }
}

export function Toast({ toast }: { toast: ToastMsg | null }) {
  if (!toast) return null
  return <div className={`toast toast-${toast.kind}`}>{toast.text}</div>
}
