import { Readable } from 'node:stream'
import { google } from 'googleapis'
import { config, googleConfigured } from '../lib/env.js'

const SCOPES = ['https://www.googleapis.com/auth/drive.file']

let clientPromise = null

function getDrive() {
  if (!clientPromise) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: config.google.clientEmail,
        private_key: config.google.privateKey,
      },
      scopes: SCOPES,
    })
    clientPromise = google.drive({ version: 'v3', auth })
  }
  return clientPromise
}

/**
 * Upload satu file rekaman ke folder Google Drive yang dikonfigurasi.
 * @returns {Promise<{fileId: string, fileName: string, fileUrl: string, mocked: boolean}>}
 */
export async function uploadFile(buffer, fileName, mimeType) {
  if (!googleConfigured()) {
    console.log(`[mock:drive] file diterima: ${fileName} (${mimeType}, ${buffer.length} byte)`)
    return {
      fileId: 'mock-file-id',
      fileName,
      fileUrl: 'https://drive.google.com/mock',
      mocked: true,
    }
  }

  const drive = await getDrive()
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType,
      parents: [config.google.driveFolderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id,name,mimeType,size',
  })

  return {
    fileId: res.data.id,
    fileName: res.data.name,
    fileUrl: `https://drive.google.com/file/d/${res.data.id}/view`,
    mocked: false,
  }
}
