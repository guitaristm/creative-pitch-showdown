// ponytail: WebAudio tones instead of an audio file — nothing to host, and no autoplay-blocked <audio> element
let ctx: AudioContext | null = null

/** Browsers block audio until the page has been interacted with; the audience page calls this on first click/key. */
export function unlockAudio() {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx.state === 'running'
}

/** Two soft bell tones — a gentle "time check" reminder, audible over a room without startling it. */
export function playChime() {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  const now = ctx.currentTime
  for (const [i, freq] of [880, 1174.7].entries()) {
    const t = now + i * 0.28
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    // quick attack, long decay = bell-like rather than a harsh beep
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.35, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.1)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 1.2)
  }
}
