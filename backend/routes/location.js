import { Router } from 'express'
import { locationSchema, formatIssues } from '../lib/schemas.js'
import { config, googleConfigured } from '../lib/env.js'
import { appendLocation } from '../services/googleSheets.js'

const router = Router()

router.post('/', async (req, res) => {
  const parsed = locationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: formatIssues(parsed.error) })
  }

  const d = parsed.data
  // Hanya kolom ini yang pernah ditulis ke sheet. Tidak ada email, nama, atau
  // pengenal lain yang tidak diminta.
  const values = [[d.timestamp, d.latitude, d.longitude, d.accuracy, d.userAgent, d.sessionId]]

  try {
    const result = await appendLocation(values)
    return res.status(201).json({
      success: true,
      rowsAppended: result.rowsAppended,
      mocked: result.mocked,
    })
  } catch (err) {
    console.error('[location] gagal menulis ke Google Sheets:', err.message)
    return res.status(502).json({ success: false, error: 'Gagal menyimpan lokasi.' })
  }
})

router.get('/config', (_req, res) => {
  res.json({
    // Hanya bool, bukan kredensial apa pun.
    googleConfigured: googleConfigured(),
    sheetRange: config.google.sheetRange,
    maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024),
  })
})

export default router
