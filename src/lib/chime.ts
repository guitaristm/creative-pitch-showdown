// ponytail: WebAudio tones instead of an audio file — nothing to host, and no autoplay-blocked <audio> element
let ctx: AudioContext | null = null

/** Browsers block audio until the page has been interacted with; the audience page calls this on first click/key. */
export function unlockAudio() {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx.state === 'running'
}

/** One woodblock hit: pitched but percussive — fast attack, quick pitch drop, short decay. */
function knock(ac: AudioContext, out: AudioNode, t: number, freq: number, gainPeak: number) {
  for (const [mult, level, decay] of [
    [1, 1, 0.16], // fundamental
    [2.74, 0.35, 0.09], // inharmonic partial — what makes wood sound like wood, not a bell
  ] as const) {
    const osc = ac.createOscillator()
    const g = ac.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freq * mult, t)
    osc.frequency.exponentialRampToValueAtTime(freq * mult * 0.6, t + 0.05)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gainPeak * level, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay)
    osc.connect(g).connect(out)
    osc.start(t)
    osc.stop(t + decay + 0.05)
  }
  // the "brush": a whisper of filtered noise on the attack
  const noise = ac.createBufferSource()
  const buf = ac.createBuffer(1, ac.sampleRate * 0.06, ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  noise.buffer = buf
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 2200
  const ng = ac.createGain()
  ng.gain.setValueAtTime(gainPeak * 0.22, t)
  ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.05)
  noise.connect(bp).connect(ng).connect(out)
  noise.start(t)
}

/** Slack-style "knock brush" — two soft woodblock taps. Reminder, not alarm. */
export function playChime() {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  const master = ctx.createGain()
  master.gain.value = 0.9
  master.connect(ctx.destination)
  const t = ctx.currentTime + 0.02
  knock(ctx, master, t, 620, 0.5)
  knock(ctx, master, t + 0.13, 470, 0.42) // second tap slightly lower and softer
}
