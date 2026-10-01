import { Router } from 'express'
import multer from 'multer'
import { uploadMetaSchema, formatIssues, normalizeMime, ALLOWED_MIME } from '../lib/schemas.js'
import { config, googleConfigured } from '../lib/env.js'
import { uploadFile } from '../services/googleDrive.js'

const router = Router()

// Di memory, bukan disk: file langsung diteruskan ke Drive lalu dibuang.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter(_req, file, cb) {
    const mime = normalizeMime(file.mimetype)
    if (!ALLOWED_MIME.has(mime)) {
      cb(new Error(`Tipe file tidak diizinkan: ${mime}`))
      return
    }
    cb(null, true)
  },
})

router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error: `File melebihi batas ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`,
        })
      }
      return res.status(400).json({ success: false, error: err.message })
    }
    next()
  })
}, async (req, res) => {
  let meta
  try {
    meta = JSON.parse(req.body.meta || '{}')
  } catch {
    return res.status(400).json({ success: false, error: 'meta bukan JSON yang valid.' })
  }

  const parsed = uploadMetaSchema.safeParse(meta)
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: formatIssues(parsed.error) })
  }

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Field "file" wajib diisi.' })
  }
  if (req.file.size === 0) {
    return res.status(400).json({ success: false, error: 'File kosong (0 byte).' })
  }

  const declared = normalizeMime(parsed.data.mimeType)
  const actual = normalizeMime(req.file.mimetype)
  if (declared !== actual) {
    return res.status(400).json({
      success: false,
      error: `mimeType meta (${declared}) tidak cocok dengan file (${actual}).`,
    })
  }
  if (!ALLOWED_MIME.has(actual)) {
    return res.status(400).json({ success: false, error: `Tipe file tidak diizinkan: ${actual}` })
  }

  try {
    const result = await uploadFile(req.file.buffer, parsed.data.fileName, actual)
    return res.status(201).json({ success: true, ...result, sessionId: parsed.data.sessionId })
  } catch (err) {
    console.error('[upload] gagal menulis ke Google Drive:', err.message)
    return res.status(502).json({ success: false, error: 'Gagal menyimpan file.' })
  }
})

router.get('/config', (_req, res) => {
  res.json({
    googleConfigured: googleConfigured(),
    maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024),
  })
})

export default router
