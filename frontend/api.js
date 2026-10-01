import { sessionId } from './session.js'

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    throw new Error((data && data.error) || `HTTP ${response.status}`)
  }
  return data
}

/**
 * Kirim data lokasi. Field di luar kebutuhan tidak ikut dikirim:
 * hanya timestamp, koordinat, akurasi, user agent, dan session ID.
 */
export async function sendLocation(location) {
  const payload = {
    timestamp: location.timestamp,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
    userAgent: navigator.userAgent,
    sessionId,
  }
  return postJson('/api/location', payload)
}

/**
 * Kirim file rekaman ke backend. Memakai FormData supaya file tidak di-encode
 * jadi base64 (yang boros ~33% dan-consuming RAM browser).
 */
export async function uploadRecording(blob, meta) {
  const form = new FormData()
  form.append('meta', JSON.stringify({ ...meta, sessionId }))
  form.append('file', blob, meta.fileName)

  const response = await fetch('/api/upload', { method: 'POST', body: form })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    throw new Error((data && data.error) || `HTTP ${response.status}`)
  }
  return data
}
