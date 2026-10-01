// State machine ACCESS GATE.
//
// Modul ini SENGAJA bebas DOM dan bebas browser API supaya bisa diuji
// di Node (test/gate.test.js). Semua akses browser-nya di-inject lewat `adapters`.

// Enam state yang dipakai flow:
//   LOCKED -> REQUESTING_LOCATION -> LOCATION_GRANTED
//          -> REQUESTING_CAMERA   -> CAMERA_GRANTED
//          -> REQUESTING_MICROPHONE -> MICROPHONE_GRANTED
//          -> ACCESS_GRANTED
// atau, di langkah pertama yang gagal: ACCESS_DENIED.
//
// Kunci lama (INITIAL, CHECK_*, PERMISSION_DENIED, ACCESS_LOCKED) sengaja
// dipertahankan sebagai ALIAS ke string yang sama, supaya kode dan test yang
// masih memakainya tidak ikut rusak. Nilai yang dipakai logika hanya yang
// versi panjang.
export const STATE = Object.freeze({
  LOCKED: 'LOCKED',
  REQUESTING_LOCATION: 'REQUESTING_LOCATION',
  LOCATION_GRANTED: 'LOCATION_GRANTED',
  REQUESTING_CAMERA: 'REQUESTING_CAMERA',
  CAMERA_GRANTED: 'CAMERA_GRANTED',
  REQUESTING_MICROPHONE: 'REQUESTING_MICROPHONE',
  MICROPHONE_GRANTED: 'MICROPHONE_GRANTED',
  ACCESS_GRANTED: 'ACCESS_GRANTED',
  ACCESS_DENIED: 'ACCESS_DENIED',

  // Alias lama -> nilai yang sama persis.
  INITIAL: 'LOCKED',
  CHECK_LOCATION: 'REQUESTING_LOCATION',
  CHECK_CAMERA: 'REQUESTING_CAMERA',
  CHECK_MICROPHONE: 'REQUESTING_MICROPHONE',
  PERMISSION_DENIED: 'ACCESS_DENIED',
  ACCESS_LOCKED: 'ACCESS_DENIED',
})

export const PERM = Object.freeze({
  WAITING: 'waiting',
  GRANTED: 'granted',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
})

// Urutan persis seperti spesifikasi. Berhenti di langkah pertama yang gagal.
const STEPS = [
  {
    key: 'location',
    label: 'Location',
    requesting: STATE.REQUESTING_LOCATION,
    granted: STATE.LOCATION_GRANTED,
  },
  {
    key: 'camera',
    label: 'Camera',
    requesting: STATE.REQUESTING_CAMERA,
    granted: STATE.CAMERA_GRANTED,
  },
  {
    key: 'microphone',
    label: 'Microphone',
    requesting: STATE.REQUESTING_MICROPHONE,
    granted: STATE.MICROPHONE_GRANTED,
  },
]

// Error dari adapter boleh menandai dirinya `unavailable` (API tidak ada /
// insecure context) supaya UI bisa membedakan "ditolak user" dari "tidak didukung".
export class PermissionError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'PermissionError'
    this.code = code || 'denied'
  }
}

export function createGate(adapters) {
  let state = STATE.LOCKED
  let unlocked = false
  let running = false
  let error = null
  let reason = null
  const perm = { location: PERM.WAITING, camera: PERM.WAITING, microphone: PERM.WAITING }
  const listeners = new Set()

  function snapshot() {
    return {
      state,
      unlocked,
      locked: !unlocked,
      error,
      reason,
      perm: { ...perm },
    }
  }

  function emit() {
    const snap = snapshot()
    for (const fn of listeners) fn(snap)
  }

  function setState(next) {
    state = next
    emit()
  }

  function subscribe(fn) {
    listeners.add(fn)
    fn(snapshot())
    return () => listeners.delete(fn)
  }

  async function run() {
    if (running || unlocked) return snapshot()
    running = true
    error = null
    reason = null
    try {
      for (const step of STEPS) {
        // Sudah diberikan sebelumnya -> jangan panggil prompt browser lagi.
        if (perm[step.key] === PERM.GRANTED) {
          console.log(`[gate] ${step.key} already granted, skipping`)
          continue
        }

        console.log(`[gate] requesting ${step.key}...`)
        setState(step.requesting)
        try {
          await adapters[step.key]()
          console.log(`[gate] ${step.key} granted`)
        } catch (err) {
          console.warn(`[gate] ${step.key} denied:`, err.message)
          perm[step.key] =
            err && err.code === 'unavailable' ? PERM.UNAVAILABLE : PERM.DENIED
          error = err && err.message ? err.message : `${step.label} permission ditolak`
          reason = step.key
          unlocked = false
          setState(STATE.ACCESS_DENIED)
          return snapshot()
        }
        perm[step.key] = PERM.GRANTED
        setState(step.granted)
      }
      unlocked = true
      reason = null
      console.log('[gate] all permissions granted, ACCESS_GRANTED')
      setState(STATE.ACCESS_GRANTED)
    } finally {
      running = false
    }
    return snapshot()
  }

  // Retry hanya mengulang langkah yang belum granted. Langkah yang sudah
  // berhasil tidak di-prompt ulang, jadi user tidak diminta dua kali.
  function retry() {
    if (unlocked || running) return Promise.resolve(snapshot())
    for (const step of STEPS) {
      if (perm[step.key] !== PERM.GRANTED) perm[step.key] = PERM.WAITING
    }
    error = null
    reason = null
    setState(STATE.LOCKED)
    return run()
  }

  /**
   * Stream yang sudah diberikan tiba-tiba mati (user menekan "Stop sharing",
   * perangkat dicabut, atau tab di-suspend). Website harus terkunci lagi
   * karena syarat "kamera + mikrofon aktif" sudah tidak terpenuhi.
   */
  function markStreamLost(key) {
    if (!(key in perm)) return snapshot()
    perm[key] = PERM.DENIED
    unlocked = false
    error = `${STEPS.find((s) => s.key === key).label} berhenti di tengah sesi.`
    reason = key
    setState(STATE.ACCESS_DENIED)
    return snapshot()
  }

  return {
    get state() {
      return state
    },
    get unlocked() {
      return unlocked
    },
    snapshot,
    subscribe,
    run,
    retry,
    markStreamLost,
  }
}

export { STEPS }
