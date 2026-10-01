import fs from 'node:fs'

// Muat .env (Node >= 20.12) sebelum process.env dibaca. Diletakkan di dalam
// modul ini karena import di ESM dievaluasi sebelum body server.js berjalan,
// sehingga pemanggilan di server.js akan terlambat.
try {
  process.loadEnvFile()
} catch {
  // .env opsional: env bisa juga diset langsung di shell.
}

const num = (name, fallback) => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Env ${name} harus berupa angka, dapat "${raw}".`)
  }
  return parsed
}

const list = (name, fallback) =>
  String(process.env[name] || fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const optionalPath = (name) => {
  const value = process.env[name]
  if (!value) return null
  if (!fs.existsSync(value)) {
    throw new Error(`Env ${name} menunjuk file yang tidak ada: ${value}`)
  }
  return value
}

export const config = {
  port: num('PORT', 3000),
  allowedOrigins: list('ALLOWED_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000'),
  maxUploadBytes: Math.round(num('MAX_UPLOAD_MB', 100) * 1024 * 1024),
  tls: {
    certPath: optionalPath('TLS_CERT_PATH'),
    keyPath: optionalPath('TLS_KEY_PATH'),
  },
  google: {
    // Private key dari .env sering ditulis dengan literal "\n".
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    sheetId: process.env.GOOGLE_SHEET_ID || '',
    sheetRange: process.env.GOOGLE_SHEET_RANGE || 'Sheet1!A:F',
    driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
  },
}

if ((config.tls.certPath && !config.tls.keyPath) || (!config.tls.certPath && config.tls.keyPath)) {
  throw new Error('TLS_CERT_PATH dan TLS_KEY_PATH harus diisi berdua atau keduanya kosong.')
}

/** Kredensial lengkap? Kalau tidak, backend jalan dalam mode mock. */
export function googleConfigured() {
  const g = config.google
  return Boolean(g.clientEmail && g.privateKey.includes('PRIVATE KEY') && g.sheetId && g.driveFolderId)
}

export function missingGoogleConfig() {
  const g = config.google
  const missing = []
  if (!g.clientEmail) missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL')
  if (!g.privateKey.includes('PRIVATE KEY')) missing.push('GOOGLE_PRIVATE_KEY')
  if (!g.sheetId) missing.push('GOOGLE_SHEET_ID')
  if (!g.driveFolderId) missing.push('GOOGLE_DRIVE_FOLDER_ID')
  return missing
}
