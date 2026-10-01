import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  locationSchema,
  uploadMetaSchema,
  normalizeMime,
  ALLOWED_MIME,
} from '../backend/lib/schemas.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const validLocation = {
  timestamp: new Date().toISOString(),
  latitude: -6.2,
  longitude: 106.816666,
  accuracy: 12.5,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140',
  sessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
}

test('payload lokasi yang valid diterima', () => {
  const parsed = locationSchema.safeParse(validLocation)
  assert.equal(parsed.success, true)
})

test('kolom tambahan ditolak (tidak ada data pribadi diam-diam)', () => {
  const parsed = locationSchema.safeParse({ ...validLocation, email: 'x@y.com' })
  assert.equal(parsed.success, false, 'kolom di luar skema harus ditolak')
})

test('koordinat di luar rentang ditolak', () => {
  assert.equal(locationSchema.safeParse({ ...validLocation, latitude: 91 }).success, false)
  assert.equal(locationSchema.safeParse({ ...validLocation, longitude: -181 }).success, false)
})

test('nilai non-numerik dan NaN ditolak', () => {
  assert.equal(locationSchema.safeParse({ ...validLocation, accuracy: 'tidak' }).success, false)
  assert.equal(locationSchema.safeParse({ ...validLocation, latitude: NaN }).success, false)
  assert.equal(locationSchema.safeParse({ ...validLocation, latitude: Infinity }).success, false)
})

test('sessionId harus UUID', () => {
  assert.equal(locationSchema.safeParse({ ...validLocation, sessionId: 'abc' }).success, false)
})

test('timestamp harus ISO-8601 dan tidak di masa depan', () => {
  assert.equal(locationSchema.safeParse({ ...validLocation, timestamp: 'bukan tanggal' }).success, false)
  const future = new Date(Date.now() + 3600_000).toISOString()
  assert.equal(locationSchema.safeParse({ ...validLocation, timestamp: future }).success, false)
})

test('upload meta menolak fileName dengan path traversal', () => {
  const base = {
    sessionId: validLocation.sessionId,
    timestamp: validLocation.timestamp,
    kind: 'video',
    mimeType: 'video/webm',
    durationMs: 3000,
  }
  assert.equal(uploadMetaSchema.safeParse({ ...base, fileName: 'a.webm' }).success, true)
  assert.equal(uploadMetaSchema.safeParse({ ...base, fileName: '../../etc/passwd' }).success, false)
  assert.equal(uploadMetaSchema.safeParse({ ...base, fileName: 'a/b.webm' }).success, false)
  assert.equal(uploadMetaSchema.safeParse({ ...base, fileName: 'a.exe' }).success, true, 'nama bebas, mime yang dibatasi')
})

test('normalizeMime membuang parameter codecs', () => {
  assert.equal(normalizeMime('video/webm;codecs=vp8,opus'), 'video/webm')
  assert.equal(normalizeMime('AUDIO/OGG; codecs=opus'), 'audio/ogg')
  assert.equal(normalizeMime(undefined), '')
})

test('hanya tipe rekaman yang dikenal yang diizinkan', () => {
  assert.ok(ALLOWED_MIME.has(normalizeMime('video/webm;codecs=vp9,opus')))
  assert.ok(!ALLOWED_MIME.has(normalizeMime('application/x-msdownload')))
  assert.ok(!ALLOWED_MIME.has(normalizeMime('text/html')))
})

// index.html sengaja minimal, jadi kontrak yang dijaga berbalik arah: bukan
// "app.js tidak boleh kehilangan id", tapi "app.js tidak boleh mengasumsikan
// elemen ada". Elemen yang hilang harus diabaikan, bukan bikin TypeError.
test('app.js tidak mengasumsikan elemen DOM ada', () => {
  const appJs = fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8')

  // Semua pencarian id harus nullable-safe: hasilnya boleh null.
  assert.match(appJs, /const \$ = \(id\) => document\.getElementById\(id\)/)
  assert.ok(
    !/\.textContent\s*=|\.srcObject\s*=/.test(appJs),
    'app.js tidak boleh menulis teks atau preview; tampilan itu urusan konsumen UI',
  )
  assert.ok(
    !/document\.querySelector\(|document\.createElement\(/.test(appJs),
    'orkestrator tidak boleh membuat elemen sendiri',
  )
})

test('shell index.html hanya punya hook, tanpa teks disclosure', () => {
  const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8')
  const appJs = fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8')

  // Hook yang dibaca app.js harus ada.
  const ids = [...appJs.matchAll(/\$\('([a-z-]+)'\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(ids)].sort(), ['access-gate', 'access-retry', 'access-status'])

  // Tidak boleh ada banner disclosure lagi, dan tidak ada teks yang ditulis
  // ke gate/status oleh app.js.
  assert.ok(!/class="disclosure"/.test(html), 'banner disclosure sudah dihapus')
  assert.ok(
    !/access-(?:gate|status)[\s\S]{0,200}>\s*[A-Za-z]{3,}/.test(html),
    '#access-gate dan #access-status harus tanpa teks; UI menampilkan sendiri',
  )
})

test('rekaman dimulai otomatis, tidak ada tombol start/stop di markup', () => {
  const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8')
  const appJs = fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8')

  assert.ok(!/id="rec-(?:start|stop|upload)"/.test(html), 'tombol rekam tidak boleh ada di markup')
  assert.ok(!/id="preview"/.test(html), 'preview kamera tidak ada di shell minimal')
  assert.match(appJs, /recorder\.start\(\)/, 'rekaman harus mulai otomatis dari orchestrator')
})

