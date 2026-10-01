import { test } from 'node:test'
import assert from 'node:assert/strict'

// Modul recorder tidak menyentuh browser saat diimpor, jadi MediaRecorder dan
// MediaStream bisa dipasang lewat globalThis sebelum makeFake siap dipakai.
import {
  createRecorder,
  combineStreams,
  getActiveRecorder,
  RECORDER_STATE,
} from '../frontend/recorder.js'

// --- Fake browser primitives -------------------------------------------------

class FakeTrack {
  constructor(kind, id) {
    this.kind = kind
    this.id = id
    this.readyState = 'live'
    this.listeners = new Set()
  }

  addEventListener(type, fn) {
    if (type === 'ended') this.listeners.add(fn)
  }

  removeEventListener(type, fn) {
    this.listeners.delete(fn)
  }

  stop() {
    this.readyState = 'ended'
  }

  die() {
    this.stop()
    for (const fn of [...this.listeners]) fn()
  }
}

class FakeStream {
  constructor(tracks) {
    this.tracks = tracks
    this.active = true
  }

  getTracks() {
    return this.tracks
  }

  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video')
  }

  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio')
  }
}

globalThis.MediaStream = FakeStream

class FakeMediaRecorder {
  constructor(stream, opts) {
    this.stream = stream
    this.mimeType = opts?.mimeType ?? 'video/webm'
    this.state = 'inactive'
    this.startCalls = 0
    this.stopCalls = 0
    this.listeners = new Map()
    created.push(this)
  }

  static isTypeSupported(type) {
    return type.startsWith('video/webm')
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
  }

  fire(type, payload = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(payload)
  }

  start() {
    this.startCalls += 1
    this.state = 'recording'
  }

  // Browser benar-benar emit dataavailable sebelum stop.
  stop() {
    this.stopCalls += 1
    this.state = 'inactive'
    this.fire('dataavailable', { data: new Blob(['x'.repeat(10)], { type: this.mimeType }) })
    this.fire('stop')
  }
}

globalThis.MediaRecorder = FakeMediaRecorder
// Setiap instance yang dibuat dicatat, supaya test bisa memastikan tidak ada
// start() ganda di underlying MediaRecorder.
const created = []

function makeStream() {
  return new FakeStream([new FakeTrack('video', 1), new FakeTrack('audio', 2)])
}

function clearRegistry() {
  const active = getActiveRecorder()
  if (active) active.dispose()
}

// --- Tests ------------------------------------------------------------------

test('combineStreams menolak stream kosong', () => {
  assert.throws(() => combineStreams([new FakeStream([]), null]), /tidak ada track/i)
})

test('combineStreams menggabungkan video + audio', () => {
  const combined = combineStreams([new FakeStream([new FakeTrack('video', 1)]), new FakeStream([new FakeTrack('audio', 2)])])
  assert.equal(combined.getTracks().length, 2)
})

test('hanya boleh ada satu recorder hidup; yang lama di-dispose', () => {
  clearRegistry()
  created.length = 0
  const first = createRecorder(makeStream(), { sessionId: 'a' })
  first.start()
  assert.equal(getActiveRecorder(), first)

  const second = createRecorder(makeStream(), { sessionId: 'b' })
  assert.equal(getActiveRecorder(), second, 'registry menunjuk instance terbaru')
  assert.notEqual(second, first)
  assert.equal(created[0].state, 'inactive', 'recorder lama sudah di-stop, tidak merekam diam-diam')

  clearRegistry()
})

test('start() idempotent: underlying MediaRecorder hanya start sekali', () => {
  clearRegistry()
  created.length = 0
  const rec = createRecorder(makeStream(), { sessionId: 'a' })
  rec.start()
  rec.start()
  rec.start()

  assert.equal(rec.state, RECORDER_STATE.RECORDING)
  assert.equal(created.length, 1, 'hanya boleh ada satu MediaRecorder untuk satu sesi')
  assert.equal(created[0].startCalls, 1, 'start() tidak boleh dipanggil berulang pada instance yang sama')
  clearRegistry()
})

test('stop() idempotent: panggil berkali-kali tetap hasil yang sama', async () => {
  clearRegistry()
  const rec = createRecorder(makeStream(), { sessionId: 'a' })
  rec.start()

  const first = await rec.stop()
  const second = await rec.stop()
  const third = await rec.stop()

  assert.ok(first && first.blob instanceof Blob)
  assert.equal(first.blob.size, 10)
  assert.equal(second, first, 'panggilan kedua mengembalikan hasil yang sama')
  assert.equal(third, first)
  assert.equal(rec.state, RECORDER_STATE.STOPPED)
  clearRegistry()
})

test('stop() sebelum start() resolve null, bukan reject', async () => {
  clearRegistry()
  const rec = createRecorder(makeStream(), { sessionId: 'a' })
  assert.equal(await rec.stop(), null)
  clearRegistry()
})

test('track video ended -> rekaman berhenti otomatis', async () => {
  clearRegistry()
  const stream = makeStream()
  const rec = createRecorder(stream, { sessionId: 'a' })
  rec.start()
  assert.equal(rec.state, RECORDER_STATE.RECORDING)

  stream.getVideoTracks()[0].die()
  const result = await rec.stop()

  assert.equal(rec.state, RECORDER_STATE.STOPPED)
  assert.ok(result && result.blob.size > 0, 'data sebelum track mati harus tersimpan')
  clearRegistry()
})

test('buildUploadMeta menghasilkan metadata yang lolos skema backend', () => {
  clearRegistry()
  const rec = createRecorder(makeStream(), { sessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' })
  rec.start()
  const meta = rec.buildUploadMeta({ blob: new Blob(['x']), mimeType: 'video/webm', durationMs: 1234 })
  assert.equal(meta.kind, 'video')
  assert.equal(meta.mimeType, 'video/webm')
  assert.match(meta.fileName, /^recording-[\w-]+\.webm$/)
  assert.equal(meta.durationMs, 1234)
  assert.equal(meta.sessionId, '3f2504e0-4f89-41d3-9a0c-0305e82c3301')
  clearRegistry()
})
