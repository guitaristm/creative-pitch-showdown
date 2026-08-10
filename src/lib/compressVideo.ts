// Shrink an oversized video in the browser before upload — no server, no ffmpeg dependency.
// ponytail: canvas + MediaRecorder (built into Chrome) instead of ffmpeg.wasm (~30 MB download).
// Ceiling: encoding runs in real time (a 1-min clip takes ~1 min). Fine for 17 short pitch videos;
// if that ever hurts, swap in WebCodecs for faster-than-realtime encoding.

export const MAX_UPLOAD_MB = 45 // Supabase free tier rejects >50 MB; leave headroom

/** Pick the best container the browser can actually encode. mp4 if offered, else webm. */
function pickMime(): string | undefined {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  return candidates.find((m) => MediaRecorder.isTypeSupported(m))
}

export interface CompressOptions {
  maxHeight?: number
  bitrate?: number
  onProgress?: (pct: number) => void
}

export async function compressVideo(file: File, opts: CompressOptions = {}): Promise<File> {
  const { maxHeight = 720, bitrate = 2_500_000, onProgress } = opts
  const mime = pickMime()
  if (!mime) throw new Error('This browser cannot re-encode video — use HandBrake instead.')

  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = url
  video.playsInline = true
  video.preload = 'auto'

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('Could not read that video file.'))
    })

    const scale = Math.min(1, maxHeight / video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round((video.videoWidth * scale) / 2) * 2 // even dimensions keep encoders happy
    canvas.height = Math.round((video.videoHeight * scale) / 2) * 2
    const ctx2d = canvas.getContext('2d')!

    const stream = canvas.captureStream(30)

    // Route the element's audio into the recording. createMediaElementSource also detaches it
    // from the speakers, so nothing is audible while processing.
    let audioCtx: AudioContext | null = null
    try {
      audioCtx = new AudioContext()
      const dest = audioCtx.createMediaStreamDestination()
      audioCtx.createMediaElementSource(video).connect(dest)
      for (const track of dest.stream.getAudioTracks()) stream.addTrack(track)
    } catch {
      // no audio track (or blocked) — video-only output is still fine
    }

    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate })
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)

    const done = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })

    recorder.start(1000)
    await video.play()

    let raf = 0
    const draw = () => {
      ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height)
      onProgress?.(Math.min(99, Math.round((video.currentTime / (video.duration || 1)) * 100)))
      raf = requestAnimationFrame(draw)
    }
    draw()

    await new Promise<void>((resolve) => {
      video.onended = () => resolve()
    })
    cancelAnimationFrame(raf)
    recorder.stop()
    await done
    await audioCtx?.close()

    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm'
    const blob = new Blob(chunks, { type: mime.split(';')[0] })
    onProgress?.(100)
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + `-720p.${ext}`, { type: blob.type })
  } finally {
    URL.revokeObjectURL(url)
  }
}
