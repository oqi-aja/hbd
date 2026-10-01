import { z } from 'zod'

// Semua input dari client dianggap tidak dipercaya. Skema ini menutup
// kolom di luar yang dibutuhkan, bukan cuma memeriksa tipe.

const isoDate = z
  .string()
  .min(10)
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'timestamp harus tanggal ISO-8601' })
  // Tolak timestamp yang terlalu jauh di masa depan (clock dimanipulasi).
  .refine((v) => Date.parse(v) <= Date.now() + 5 * 60_000, {
    message: 'timestamp tidak boleh di masa depan',
  })

export const locationSchema = z
  .object({
    timestamp: isoDate,
    latitude: z.number().refine(Number.isFinite).min(-90).max(90),
    longitude: z.number().refine(Number.isFinite).min(-180).max(180),
    accuracy: z.number().refine(Number.isFinite).min(0).max(100_000),
    userAgent: z.string().max(1024),
    sessionId: z.uuid(),
  })
  .strict()

export const uploadMetaSchema = z
  .object({
    sessionId: z.uuid(),
    timestamp: isoDate,
    kind: z.enum(['video', 'audio']),
    mimeType: z.string().min(1).max(128),
    fileName: z
      .string()
      .min(1)
      .max(128)
      // Cegah path traversal dan karakter kontrol kalau nama file dipakai Drive.
      .regex(/^[\w.\-]+$/, 'fileName hanya boleh huruf, angka, titik, strip, dan underscore'),
    durationMs: z.number().refine(Number.isFinite).min(0).max(24 * 60 * 60 * 1000),
  })
  .strict()

/** Daftar mime yang boleh masuk rekaman; bagian codecs diabaikan saat pencocokan. */
export const ALLOWED_MIME = new Set([
  'video/webm',
  'video/x-matroska',
  'video/mp4',
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
])

export function normalizeMime(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase()
}

/** Format zod error jadi satu string ringkas untuk response. */
export function formatIssues(error) {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}
