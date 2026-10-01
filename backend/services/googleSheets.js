import { google } from 'googleapis'
import { config, googleConfigured } from '../lib/env.js'

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

let clientPromise = null

function getSheets() {
  if (!clientPromise) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: config.google.clientEmail,
        private_key: config.google.privateKey,
      },
      scopes: SCOPES,
    })
    clientPromise = google.sheets({ version: 'v4', auth })
  }
  return clientPromise
}

/**
 * Tambahkan satu baris lokasi ke sheet.
 * @param {Array<Array<string|number>>} values
 * @returns {Promise<{rowsAppended: number, mocked: boolean}>}
 */
export async function appendLocation(values) {
  if (!googleConfigured()) {
    // Mode mock: payload ditulis ke console supaya alur bisa dites tanpa Google.
    console.log('[mock:sheets] lokasi diterima:', JSON.stringify(values[0]))
    return { rowsAppended: 1, mocked: true }
  }

  const sheets = await getSheets()
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: config.google.sheetId,
    range: config.google.sheetRange,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  })
  return { rowsAppended: res.data.updates?.updatedRows ?? values.length, mocked: false }
}
