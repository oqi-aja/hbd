import { PermissionError } from './permissions.js'

// Semua yang dikembalikan ini dikirim apa adanya ke backend; backend tetap
// memvalidasi ulang (jangan percaya client).

function assertSecureContext() {
  if (!window.isSecureContext) {
    throw new PermissionError(
      'Geolocation butuh secure context. Buka lewat http://localhost atau HTTPS.',
      'unavailable',
    )
  }
}

/**
 * Minta izin lokasi dan pastikan browser benar-benar mengembalikan koordinat.
 * Permission "granted" saja tidak dianggap sukses: kalau position/coordination
 * kosong, future ini tetap reject dan gate tetap terkunci.
 */
export function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new PermissionError('Geolocation tidak tersedia di browser ini.', 'unavailable'))
      return
    }
    assertSecureContext()

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords || {}

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          reject(
            new PermissionError(
              'Browser memberi izin lokasi tapi tidak mengembalikan koordinat.',
              'denied',
            ),
          )
          return
        }
        if (!Number.isFinite(accuracy)) {
          reject(new PermissionError('Akurasi lokasi tidak valid.', 'denied'))
          return
        }
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
          reject(new PermissionError('Koordinat di luar rentang valid.', 'denied'))
          return
        }

        resolve({
          timestamp: new Date(position.timestamp || Date.now()).toISOString(),
          latitude,
          longitude,
          accuracy,
          permission: 'granted',
        })
      },
      (err) => {
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
        // Ketiganya tetap mengunci website.
        const messages = {
          1: 'Location permission ditolak.',
          2: 'Lokasi tidak dapat ditentukan.',
          3: 'Permintaan lokasi timeout.',
        }
        const code = err && err.code === 1 ? 'denied' : 'denied'
        reject(new PermissionError(messages[err?.code] || 'Gagal memperoleh lokasi.', code))
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}
