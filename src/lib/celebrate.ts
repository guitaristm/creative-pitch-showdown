// Celebration audio: synthesised applause + firework bangs. No audio files to host.
// ponytail: applause is rendered into one buffer instead of scheduling hundreds of nodes.
let ctx: AudioContext | null = null

function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** A crowd is just a lot of random claps — short noise bursts with fast decay. */
function applauseBuffer(a: AudioContext, seconds: number): AudioBuffer {
  const rate = a.sampleRate
  const buf = a.createBuffer(2, Math.ceil(rate * seconds), rate)
  const clapsPerSecond = 90
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < clapsPerSecond * seconds; i++) {
      const start = Math.floor(Math.random() * data.length)
      const len = Math.floor(rate * (0.02 + Math.random() * 0.05))
      const amp = 0.25 + Math.random() * 0.5
      for (let j = 0; j < len && start + j < data.length; j++) {
        const decay = Math.pow(1 - j / len, 3)
        data[start + j] += (Math.random() * 2 - 1) * amp * decay
      }
    }
    // swell in, hold, fade out so it doesn't start or stop abruptly
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length
      const env = Math.min(1, t * 8) * Math.min(1, (1 - t) * 4)
      data[i] *= env * 0.5
    }
  }
  return buf
}

/** Whistle up, then a bang: one firework. */
function firework(a: AudioContext, out: AudioNode, t: number) {
  const whistle = a.createOscillator()
  const wg = a.createGain()
  whistle.type = 'sine'
  whistle.frequency.setValueAtTime(400, t)
  whistle.frequency.exponentialRampToValueAtTime(1700, t + 0.45)
  wg.gain.setValueAtTime(0.0001, t)
  wg.gain.exponentialRampToValueAtTime(0.12, t + 0.2)
  wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
  whistle.connect(wg).connect(out)
  whistle.start(t)
  whistle.stop(t + 0.55)

  const bangAt = t + 0.5
  const noise = a.createBufferSource()
  const len = Math.floor(a.sampleRate * 0.7)
  const buf = a.createBuffer(1, len, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
  noise.buffer = buf
  const lp = a.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(2000, bangAt)
  lp.frequency.exponentialRampToValueAtTime(300, bangAt + 0.6)
  const ng = a.createGain()
  ng.gain.setValueAtTime(0.55, bangAt)
  ng.gain.exponentialRampToValueAtTime(0.0005, bangAt + 0.7)
  noise.connect(lp).connect(ng).connect(out)
  noise.start(bangAt)

  // low thump for the chest-punch
  const thump = a.createOscillator()
  const tg = a.createGain()
  thump.type = 'sine'
  thump.frequency.setValueAtTime(90, bangAt)
  thump.frequency.exponentialRampToValueAtTime(35, bangAt + 0.25)
  tg.gain.setValueAtTime(0.5, bangAt)
  tg.gain.exponentialRampToValueAtTime(0.0005, bangAt + 0.35)
  thump.connect(tg).connect(out)
  thump.start(bangAt)
  thump.stop(bangAt + 0.4)
}

/** Applause bed + a handful of fireworks scattered across the celebration. */
export function playCelebration(seconds = 7) {
  const a = ac()
  const master = a.createGain()
  master.gain.value = 0.9
  master.connect(a.destination)
  const t0 = a.currentTime + 0.05

  const clap = a.createBufferSource()
  clap.buffer = applauseBuffer(a, seconds)
  const cg = a.createGain()
  cg.gain.value = 0.85
  clap.connect(cg).connect(master)
  clap.start(t0)

  for (let i = 0; i < 5; i++) firework(a, master, t0 + 0.2 + i * (seconds - 1.5) / 5 + Math.random() * 0.3)
}
