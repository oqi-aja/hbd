import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import cors from 'cors'
import express from 'express'

import { config, googleConfigured, missingGoogleConfig } from './lib/env.js'
import locationRouter from './routes/location.js'
import uploadRouter from './routes/upload.js'

const backendDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(backendDir, '..', 'frontend')

const app = express()
app.disable('x-powered-by')

// CORS allowlist, bukan wildcard. Request tanpa Origin (curl, health check)
// tetap lewat supaya Endpoint bisa dites dari terminal.
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true)
      callback(null, config.allowedOrigins.includes(origin))
    },
    methods: ['GET', 'POST'],
  }),
)

app.use(express.json({ limit: '32kb' }))

// Header dasar untuk halaman yang memakai kamera/mikrofon/lokasi.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)')
  next()
})

app.use('/api/location', locationRouter)
app.use('/api/upload', uploadRouter)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, googleConfigured: googleConfigured(), uptime: process.uptime() })
})

// Satu proses menyajikan frontend juga, jadi development tidak butuh CORS.
app.use(express.static(frontendDir, { extensions: ['html'] }))

app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint tidak ditemukan.' })
})

// Empat argumen: ini(error), req, res, next adalah bentuk yang dikenali
// Express sebagai error handler.
app.use((err, _req, res, _next) => {
  console.error('[server]', err)
  res.status(500).json({ success: false, error: 'Kesalahan internal server.' })
})

function start() {
  const { certPath, keyPath } = config.tls
  const server =
    certPath && keyPath
      ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app)
      : http.createServer(app)

  const scheme = certPath && keyPath ? 'https' : 'http'

  server.listen(config.port, () => {
    console.log(`\n${scheme}://localhost:${config.port}`)
    console.log(`Origin yang diizinkan: ${config.allowedOrigins.join(', ')}`)
    if (googleConfigured()) {
      console.log('Google: terkonfigurasi (Sheets + Drive)')
    } else {
      console.log(`Google: MODE MOCK (belum menulis ke Sheets/Drive)`)
      console.log(`  Variabel belum diisi: ${missingGoogleConfig().join(', ')}`)
    }
    console.log('')
  })
}

start()
