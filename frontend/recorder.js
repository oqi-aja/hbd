// Modul RECORDING terpisah, tanpa DOM dan tanpa tombol.
//
// Aturan yang dipegang modul ini:
// - Tidak pernah dibuat sebelum camera DAN microphone benar-benar punya track.
// - start() dipanggil orchestrator tepat setelah ACCESS_GRANTED, bukan oleh UI.
// - Satu proses = satu MediaRecorder. createRecorder() men-disable instance
//   sebelumnya, jadi app yang di-reload dua kali tidak menyisakan recorder
//   yang masih merekam di background.
// - Rekaman berhenti sendiri kalau track-nya mati, dan stop() idempotent
//   supaya pagehide dan track-ended tidak saling stop dua kali.

const MIME_CANDIDATES = {
  video: [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ],
  audio: ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mpeg'],
}

export const RECORDER_STATE = Object.freeze({
  IDLE: 'idle',
  RECORDING: 'recording',
  STOPPED: 'stopped',
})

// Registry modul: hanya boleh ada satu recorder hidup.
let activeRecorder = null

export function getActiveRecorder() {
  return activeRecorder
}

function pickMimeType(kind) {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const type of MIME_CANDIDATES[kind] || []) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

/**
 * Gabungkan track video + audio menjadi satu stream rekaman.
 * @param {MediaStream[]} streams
 */
export function combineStreams(streams) {
  const tracks = streams.filter(Boolean).flatMap((s) => s.getTracks())
  if (tracks.length === 0) throw new Error('Tidak ada track untuk direkam.')
  return new MediaStream(tracks)
}

export function createRecorder(stream, { sessionId, kind, onStateChange } = {}) {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder tidak didukung browser ini.')
  }
  if (!stream || !stream.getTracks().length) {
    throw new Error('Recorder membutuhkan MediaStream yang sudah aktif.')
  }

  // Jangan pernah ada dua recorder hidup dalam satu proses.
  if (activeRecorder) activeRecorder.dispose()

  const mimeType = pickMimeType(kind || (stream.getVideoTracks().length ? 'video' : 'audio'))
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks = []

  let state = RECORDER_STATE.IDLE
  let startedAt = 0
  let lastResult = null

  const announce = () => {
    if (onStateChange) {
      onStateChange({
        state,
        durationMs: state === RECORDER_STATE.RECORDING ? Date.now() - startedAt : (lastResult?.durationMs ?? 0),
      })
    }
  }

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data)
  })

  // Track mati = sumber rekaman hilang. Stop sekarang, jangan biarkan
  // MediaRecorder merekam senyap dari stream yang sudah tidak ada.
  for (const track of stream.getTracks()) {
    track.addEventListener('ended', () => {
      stop()
    })
  }

  function start() {
    if (state === RECORDER_STATE.RECORDING) return
    chunks.length = 0
    lastResult = null
    recorder.start(1000) // potong 1 detik, supaya data tidak tertahan di memori
    startedAt = Date.now()
    state = RECORDER_STATE.RECORDING
    announce()
  }

  /**
   * Idempotent. Kalau belum pernah mulai -> null. Kalau sudah berhenti ->
   * hasil sebelumnya. Dipanggil pagehide, track-ended, dan dispose, jadi
   * harus aman dipanggil berkali-kali.
   * @returns {Promise<{blob: Blob, mimeType: string, durationMs: number}|null>}
   */
  function stop() {
    if (state === RECORDER_STATE.STOPPED) return Promise.resolve(lastResult)
    if (state !== RECORDER_STATE.RECORDING) return Promise.resolve(null)

    return new Promise((resolve) => {
      recorder.addEventListener(
        'stop',
        () => {
          state = RECORDER_STATE.STOPPED
          const blob = new Blob(chunks, { type: recorder.mimeType || 'application/octet-stream' })
          lastResult = { blob, mimeType: blob.type, durationMs: Date.now() - startedAt }
          announce()
          resolve(lastResult)
        },
        { once: true },
      )
      recorder.addEventListener('error', () => resolve(null), { once: true })
      recorder.stop()
    })
  }

  /** Metadata yang menyertai file saat di-upload. */
  function buildUploadMeta(result) {
    const stamp = new Date().toISOString()
    const ext = result.mimeType.includes('mp4')
      ? 'mp4'
      : result.mimeType.includes('mpeg')
        ? 'mp3'
        : 'webm'
    return {
      sessionId,
      timestamp: stamp,
      kind: result.mimeType.startsWith('video/') ? 'video' : 'audio',
      mimeType: result.mimeType,
      fileName: `recording-${stamp.replace(/[:.]/g, '-')}.${ext}`,
      durationMs: result.durationMs,
    }
  }

  function dispose() {
    if (recorder.state !== 'inactive') {
      recorder.stop()
      chunks.length = 0
    }
    state = RECORDER_STATE.IDLE
    if (activeRecorder === instance) activeRecorder = null
  }

  const instance = {
    start,
    stop,
    buildUploadMeta,
    dispose,
    get state() {
      return state
    },
    get mimeType() {
      return recorder.mimeType
    },
  }

  activeRecorder = instance
  announce()
  return instance
}
