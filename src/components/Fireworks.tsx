// Full-screen fireworks + confetti overlay. Canvas particles — no library.
import { useEffect, useRef } from 'react'

const COLORS = ['#f5c542', '#6d8dff', '#3ecf8e', '#ff5c6c', '#ffffff', '#ff9ff3']

interface P {
  x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; spin: number; strip: boolean
}

export function Fireworks({ seconds = 7, onDone }: { seconds?: number; onDone?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const resize = () => {
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const W = () => canvas.width / dpr
    const H = () => canvas.height / dpr
    const parts: P[] = []

    const burst = (x: number, y: number) => {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]
      for (let i = 0; i < 90; i++) {
        const angle = (Math.PI * 2 * i) / 90 + Math.random() * 0.1
        const speed = 2 + Math.random() * 4.5
        parts.push({
          x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life: 0, max: 60 + Math.random() * 40,
          color: Math.random() < 0.25 ? COLORS[Math.floor(Math.random() * COLORS.length)] : color,
          size: 1.5 + Math.random() * 2, spin: 0, strip: false,
        })
      }
    }

    const confetti = (n: number) => {
      for (let i = 0; i < n; i++) {
        parts.push({
          x: Math.random() * W(), y: -20 - Math.random() * H() * 0.4,
          vx: (Math.random() - 0.5) * 1.5, vy: 1.5 + Math.random() * 2.5,
          life: 0, max: 300, color: COLORS[Math.floor(Math.random() * COLORS.length)],
          size: 4 + Math.random() * 5, spin: Math.random() * 0.3, strip: true,
        })
      }
    }

    const start = performance.now()
    let next = 0
    let raf = 0

    const frame = (now: number) => {
      const elapsed = (now - start) / 1000
      if (elapsed > next && elapsed < seconds - 0.6) {
        burst(W() * (0.15 + Math.random() * 0.7), H() * (0.15 + Math.random() * 0.45))
        next = elapsed + 0.45 + Math.random() * 0.5
      }
      ctx.clearRect(0, 0, W(), H())
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        p.life++
        p.x += p.vx
        p.y += p.vy
        if (p.strip) {
          p.vx += Math.sin((p.life + p.x) / 20) * 0.06 // flutter
          p.spin += 0.15
          if (p.y > H() + 30) { parts.splice(i, 1); continue }
        } else {
          p.vy += 0.06 // gravity
          p.vx *= 0.985
          p.vy *= 0.985
          if (p.life > p.max) { parts.splice(i, 1); continue }
        }
        const alpha = p.strip ? Math.min(1, (seconds * 60 - p.life) / 60) : 1 - p.life / p.max
        ctx.globalAlpha = Math.max(0, alpha)
        ctx.fillStyle = p.color
        if (p.strip) {
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate(p.spin)
          ctx.fillRect(-p.size / 2, -p.size, p.size, p.size * 2)
          ctx.restore()
        } else {
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
      if (elapsed < seconds || parts.length) raf = requestAnimationFrame(frame)
      else onDone?.()
    }

    confetti(120)
    burst(W() / 2, H() * 0.35)
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [seconds])

  return <canvas ref={ref} className="fireworks" />
}
