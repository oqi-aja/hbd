import { PermissionError } from './permissions.js'

const VIDEO_CONSTRAINTS = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
}

// Modul ini menyimpan stream di level modul supaya app.js bisa memasang
// preview dan membuat recorder dari stream yang sama.
// Handler dipasang sebelum stream ada (app.js runs saat load), jadi daftar
// disimpan di modul dan dipasang ke track yang baru datang.
let stream = null
const endedHandlers = new Set()

function assertSecureContext() {
  if (!window.isSecureContext) {
    throw new PermissionError(
      'Kamera butuh secure context. Buka lewat http://localhost atau HTTPS.',
      'unavailable',
    )
  }
}

/**
 * Minta izin kamera secara eksplisit. Audio dimatikan supaya kamera dan
 * mikrofon tidak aktif bersamaan sebelum gate terbuka.
 * @returns {Promise<MediaStream>}
 */
export async function requestCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new PermissionError('getUserMedia tidak tersedia di browser ini.', 'unavailable')
  }
  assertSecureContext()

  const acquired = await navigator.mediaDevices.getUserMedia({
    video: VIDEO_CONSTRAINTS,
    audio: false,
  })

  stopStream() // buang stream lama kalau ada

  // Izin diberikan bukan berarti track hidup: track bisa sudah ended sebelum
  // gate selesai. Kalau begitu jangan dianggap granted.
  const track = acquired.getVideoTracks()[0]
  if (!track || track.readyState !== 'live') {
    for (const t of acquired.getTracks()) t.stop()
    throw new PermissionError('Kamera tidak benar-benar aktif.', 'denied')
  }

  track.addEventListener('ended', fireEnded)
  stream = acquired
  return stream
}

function fireEnded() {
  for (const handler of endedHandlers) handler()
}

export function getCameraStream() {
  return stream
}

export function isCameraLive() {
  return Boolean(stream && stream.active && stream.getVideoTracks().some((t) => t.readyState === 'live'))
}

/**
 * Dipanggil saat user menekan "Stop sharing" di indikator browser, supaya gate
 * tahu Capture tidak lagi berjalan. Boleh dipanggil sebelum stream ada.
 */
export function onCameraEnded(handler) {
  endedHandlers.add(handler)
  return () => endedHandlers.delete(handler)
}

export function stopStream() {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
  stream = null
}
