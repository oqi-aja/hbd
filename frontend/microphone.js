import { PermissionError } from './permissions.js'

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

let stream = null
const endedHandlers = new Set()

function assertSecureContext() {
  if (!window.isSecureContext) {
    throw new PermissionError(
      'Mikrofon butuh secure context. Buka lewat http://localhost atau HTTPS.',
      'unavailable',
    )
  }
}

/**
 * Minta izin mikrofon secara eksplisit. Video dimatikan supaya kamera dan
 * mikrofon tidak aktif bersamaan sebelum gate terbuka.
 * @returns {Promise<MediaStream>}
 */
export async function requestMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new PermissionError('getUserMedia tidak tersedia di browser ini.', 'unavailable')
  }
  assertSecureContext()

  const acquired = await navigator.mediaDevices.getUserMedia({
    audio: AUDIO_CONSTRAINTS,
    video: false,
  })

  stopStream()

  // Izin diberikan belum tentu track hidup (perangkat dicabut, user menekan
  // "Stop sharing" sebelum gate selesai).
  const track = acquired.getAudioTracks()[0]
  if (!track || track.readyState !== 'live') {
    for (const t of acquired.getTracks()) t.stop()
    throw new PermissionError('Mikrofon tidak benar-benar aktif.', 'denied')
  }

  track.addEventListener('ended', fireEnded)
  stream = acquired
  return stream
}

function fireEnded() {
  for (const handler of endedHandlers) handler()
}

export function getMicrophoneStream() {
  return stream
}

export function isMicrophoneLive() {
  return Boolean(stream && stream.active && stream.getAudioTracks().some((t) => t.readyState === 'live'))
}

/** Sama seperti kamera: boleh dipasang sebelum stream ada. */
export function onMicrophoneEnded(handler) {
  endedHandlers.add(handler)
  return () => endedHandlers.delete(handler)
}

export function stopStream() {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
  stream = null
}
