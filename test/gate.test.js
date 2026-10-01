import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createGate, PermissionError, STATE, PERM } from '../frontend/permissions.js'

// Adapter palsu: modul ini murni, jadi tidak perlu browser untuk mengujinya.
const ok = () => Promise.resolve()
const denied = () => Promise.reject(new PermissionError('ditolak user', 'denied'))
const unavailable = () => Promise.reject(new PermissionError('API tidak ada', 'unavailable'))

test('semua izin diberikan -> ACCESS_GRANTED', async () => {
  const gate = createGate({ location: ok, camera: ok, microphone: ok })
  const snap = await gate.run()

  assert.equal(snap.state, STATE.ACCESS_GRANTED)
  assert.equal(snap.unlocked, true)
  assert.equal(snap.locked, false)
  assert.equal(snap.perm.location, PERM.GRANTED)
  assert.equal(snap.perm.microphone, PERM.GRANTED)
})

test('urutan state sesuai spesifikasi', async () => {
  const seen = []
  const gate = createGate({ location: ok, camera: ok, microphone: ok })
  gate.subscribe((s) => seen.push(s.state))
  await gate.run()

  assert.deepEqual(seen, [
    STATE.INITIAL,
    STATE.CHECK_LOCATION,
    STATE.LOCATION_GRANTED,
    STATE.CHECK_CAMERA,
    STATE.CAMERA_GRANTED,
    STATE.CHECK_MICROPHONE,
    STATE.MICROPHONE_GRANTED,
    STATE.ACCESS_GRANTED,
  ])
})

test('kamera ditolak -> terkunci dan mikrofon tidak ditanya', async () => {
  let micCalled = false
  const gate = createGate({
    location: ok,
    camera: denied,
    microphone: () => {
      micCalled = true
      return ok()
    },
  })
  const snap = await gate.run()

  assert.equal(snap.state, STATE.ACCESS_LOCKED)
  assert.equal(snap.unlocked, false)
  assert.equal(snap.perm.location, PERM.GRANTED)
  assert.equal(snap.perm.camera, PERM.DENIED)
  assert.equal(snap.perm.microphone, PERM.WAITING)
  assert.equal(micCalled, false, 'mikrofon tidak boleh diminta setelah kamera gagal')
  assert.match(snap.error, /ditolak user/)
})

test('retry setelah penolakan hanya mengulang langkah yang gagal', async () => {
  let locationCalls = 0
  let cameraShouldFail = true

  const gate = createGate({
    location: () => {
      locationCalls += 1
      return ok()
    },
    camera: () => (cameraShouldFail ? denied() : ok()),
    microphone: ok,
  })

  await gate.run()
  assert.equal(gate.unlocked, false)

  cameraShouldFail = false
  const snap = await gate.retry()

  assert.equal(snap.unlocked, true)
  assert.equal(locationCalls, 1, 'izin lokasi yang sudah granted tidak di-prompt ulang')
})

test('kode unavailable dibedakan dari denied', async () => {
  const gate = createGate({ location: unavailable, camera: ok, microphone: ok })
  const snap = await gate.run()

  assert.equal(snap.perm.location, PERM.UNAVAILABLE)
  assert.equal(snap.state, STATE.ACCESS_LOCKED)
})

test('lokasi granted tapi tanpa koordinat tetap mengunci', async () => {
  // Simulasikan browser memberi izin tanpa data posisi.
  const gate = createGate({
    location: () => Promise.reject(new PermissionError('izin diberikan, koordinat kosong', 'denied')),
    camera: ok,
    microphone: ok,
  })
  const snap = await gate.run()

  assert.equal(snap.unlocked, false)
  assert.equal(snap.perm.camera, PERM.WAITING)
})

test('run() tidak bisa dipanggil dua kali bersamaan', async () => {
  let calls = 0
  const slow = () => {
    calls += 1
    return new Promise((r) => setTimeout(r, 10))
  }
  const gate = createGate({ location: slow, camera: ok, microphone: ok })

  await Promise.all([gate.run(), gate.run()])
  assert.equal(calls, 1)
})

test('kegagalan = satu state ACCESS_DENIED, tidak ada state denied terpisah', async () => {
  const gate = createGate({ location: ok, camera: denied, microphone: ok })
  const seen = []
  gate.subscribe((s) => seen.push(s.state))
  await gate.run()

  // Dulu ada dua emit (PERMISSION_DENIED lalu ACCESS_LOCKED). Sekarang satu.
  assert.equal(seen.at(-1), STATE.ACCESS_DENIED)
  assert.equal(seen.at(-1), STATE.ACCESS_LOCKED, 'alias lama harus bernilai sama')
  assert.equal(seen.filter((s) => s === STATE.ACCESS_DENIED).length, 1, 'deny cukup satu kali')
  assert.equal(seen.filter((s) => s === STATE.LOCATION_GRANTED).length, 1)
})

test('markStreamLost() mengunci lagi dan mencatat alasan', async () => {
  const gate = createGate({ location: ok, camera: ok, microphone: ok })
  await gate.run()
  assert.equal(gate.unlocked, true)

  const snap = gate.markStreamLost('camera')
  assert.equal(snap.state, STATE.ACCESS_DENIED)
  assert.equal(snap.unlocked, false)
  assert.equal(snap.locked, true)
  assert.equal(snap.reason, 'camera')
  assert.equal(snap.perm.camera, PERM.DENIED)

  // Subscribers juga ikut diberi tahu, dan state tetap terkunci.
  assert.equal(gate.state, STATE.ACCESS_DENIED)
})

test('run() setelah ACCESS_GRANTED tidak meminta prompt lagi', async () => {
  let locationCalls = 0
  let cameraCalls = 0
  let micCalls = 0
  const gate = createGate({
    location: () => {
      locationCalls += 1
      return ok()
    },
    camera: () => {
      cameraCalls += 1
      return ok()
    },
    microphone: () => {
      micCalls += 1
      return ok()
    },
  })

  await gate.run()
  const second = await gate.run()

  assert.equal(second.unlocked, true)
  assert.equal(locationCalls, 1)
  assert.equal(cameraCalls, 1)
  assert.equal(micCalls, 1, 'prompt browser hanya boleh muncul sekali per izin')
})

test('retry() saat sedang running tidak memanggil adapter lagi', async () => {
  let locationCalls = 0
  const slow = () => {
    locationCalls += 1
    return new Promise((r) => setTimeout(r, 10))
  }
  const gate = createGate({ location: slow, camera: ok, microphone: ok })

  const inFlight = gate.run()
  const retried = await gate.retry()
  const after = await inFlight

  assert.equal(locationCalls, 1, 'retry saat running tidak boleh menambah prompt')
  assert.equal(retried.state, STATE.REQUESTING_LOCATION, 'retry mengembalikan snapshot berjalan')
  assert.equal(after.unlocked, true)
})
