# Web Gate — Access Gate (Location + Camera + Microphone)

Website pribadi yang **terkunci** sampai lokasi, kamera, dan mikrofon semuanya
diizinkan. Konten dan tampilan website belum dibuat; yang ada baru sistem
gerbangnya.

Frontend adalah **logic/state layer saja**: rekaman langsung berjalan otomatis
setelah semua permission diberikan, tanpa tombol. `index.html` cuma shell tanpa
teks — indikator bawaan browser/OS (ikon kamera, mikrofon, lokasi di address
bar) adalah satu-satunya pemberitahuan. UI cukup menyimak atribut `data-*` dan
event `access-state` / `access-recording`.

> Gate ini memakai kamera, mikrofon, dan lokasi milik orang yang membuka
> halaman. Hanya jalankan di perangkat milik Anda sendiri, atau di perangkat
> orang yang benar-benar memberi izin secara sadar.

## Struktur project

```
web-gate/
├── package.json
├── .env.example
├── frontend/            # Tanpa build step, tanpa dependency
│   ├── index.html       # Shell minimal: hook + Permission-Policy, tanpa teks
│   ├── style.css        # Reset saja
│   ├── app.js           # Orchestrator: gate -> rekam otomatis -> upload
│   ├── permissions.js   # State machine ACCESS GATE (murni, bisa diuji di Node)
│   ├── location.js      # Geolocation API + validasi koordinat
│   ├── camera.js        # getUserMedia({video}) + deteksi track mati
│   ├── microphone.js    # getUserMedia({audio}) + deteksi track mati
│   ├── recorder.js      # MediaRecorder (auto-start, idempotent, auto-stop)
│   ├── session.js       # crypto.randomUUID(), disimpan di memori
│   └── api.js           # fetch ke backend
├── backend/
│   ├── server.js        # Express + static + CORS allowlist
│   ├── lib/env.js       # Baca & validasi env, deteksi mode mock
│   ├── lib/schemas.js   # Validasi zod untuk semua input client
│   ├── routes/location.js
│   ├── routes/upload.js
│   ├── services/googleSheets.js
│   └── services/googleDrive.js
└── test/
    ├── gate.test.js     # 11 test state machine
    ├── recorder.test.js # 9 test recorder (MediaRecorder palsu)
    └── validate.test.js # 11 test validasi backend + kontrak DOM minimal
```

## 1. Cara install

```bash
cd C:\Users\Lenovo\Documents\VSC\web-gate
npm install
```

Butuh Node.js >= 20.12 (sudah dipakai `process.loadEnvFile()`).
Sudah diuji dengan Node v24.15.0. Dependency hanya 5: `express`, `cors`,
`zod`, `multer`, `googleapis`.

## 2 & 3. Cara menjalankan

Frontend dan backend berjalan dalam **satu proses**. Express menyajikan
`frontend/` sebagai static, sehingga tidak ada CORS yang perlu di-debug saat
local dan hanya satu terminal yang perlu watched.

```bash
npm run dev     # node --watch backend/server.js
npm start       # tanpa watch
```

Buka <http://localhost:3000>. Port diubah lewat `PORT` di `.env`.

> **Penting:** selalu buka lewat `http://localhost`, bukan `http://127.0.0.1` dari
> HP atau lewat alamat IP LAN. Kamera, mikrofon, dan geolocation hanya jalan di
> *secure context*. `localhost` sudah dianggap secure; `192.168.x.x` tidak. Untuk
> tes dari HP, isi `TLS_CERT_PATH` dan `TLS_KEY_PATH` (lihat bagian 4).

## 4. Konfigurasi `.env`

Salin `.env.example` jadi `.env` lalu sesuaikan. Tidak ada satu pun variabel
Google yang perlu diisi agar website bisa dijalankan — tanpa itu backend masuk
**mode mock**: payload ditulis ke console dan endpoint tetap merespons sukses
dengan `mocked: true`.

| Variabel | Wajib | Keterangan |
|---|---|---|
| `PORT` | tidak | Default `3000` |
| `ALLOWED_ORIGINS` | tidak | Origin yang boleh memanggil API. Tanpa `*` |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | tidak | Wajib hanya untuk tes dari HP via LAN. Harus diisi berdua |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | untuk Google | `xxx@xxx.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | untuk Google | Tanpa header/footer `-----BEGIN/END-----`, `\n` untuk baris baru |
| `GOOGLE_SHEET_ID` | untuk Google | ID dari URL spreadsheet |
| `GOOGLE_SHEET_RANGE` | tidak | Default `Sheet1!A:F` |
| `GOOGLE_DRIVE_FOLDER_ID` | untuk Google | ID folder tujuan upload |
| `MAX_UPLOAD_MB` | tidak | Default `100` |

## 5. Konfigurasi Google Sheets

1. Buat spreadsheet baru di Google Sheets.
2. Isi baris header di `A1:F1` supaya data masuk rapi:

   | timestamp | latitude | longitude | accuracy | userAgent | sessionId |
   |---|---|---|---|---|---|

3. Aktifkan **Google Sheets API** di Google Cloud Console, lalu buat **service
   account** dan unduh key JSON.
4. Catat `client_email` dan `private_key` dari file JSON itu.
5. **Share spreadsheet** ke email service account dengan akses **Editor**. Ini
   wajib — service account tidak mewarisi akses dari akun Anda.
6. Ambil `spreadsheet_id` dari URL:
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`
7. Isi di `.env`:

   ```env
   GOOGLE_SERVICE_ACCOUNT_EMAIL=bell-123@project-abc.iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"
   GOOGLE_SHEET_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz
   GOOGLE_SHEET_RANGE=Sheet1!A:F
   ```

## 6. Konfigurasi Google Drive

1. Buat folder tujuan di Google Drive.
2. **Share folder** ke email service account yang sama, akses **Editor** atau
   **Content manager**.
3. Ambil folder ID dari URL:
   `https://drive.google.com/drive/folders/<FOLDER_ID>`
4. Isi di `.env`:

   ```env
   GOOGLE_DRIVE_FOLDER_ID=1XyZ...
   ```

Setelah `npm run dev`, baris startup berubah dari `MODE MOCK` menjadi
`Google: terkonfigurasi (Sheets + Drive)`.

### Endpoint

| Method | Path | Isi |
|---|---|---|
| `POST` | `/api/location` | `{ timestamp, latitude, longitude, accuracy, userAgent, sessionId }` |
| `POST` | `/api/upload` | `multipart/form-data`: field `meta` (JSON) + field `file` |
| `GET` | `/api/health` | status server + apakah Google terkonfigurasi |
| `GET` | `/api/location/config` | status konfigurasi (tanpa secret) |

Respons sukses upload:

```json
{ "success": true, "fileId": "...", "fileName": "...", "fileUrl": "..." }
```

## 7. Testing permission

```bash
npm test
```

31 test, tanpa framework: state machine (urutan, penolakan, retry, `unavailable`,
`markStreamLost`), recorder (anti-duplikat, `start()`/`stop()` idempotent, track
mati → auto-stop) dan validasi backend (rentang koordinat, kolom asing, UUID,
path traversal, kontrak DOM minimal).

### Menghubungkan UI sendiri

`frontend/index.html` adalah shell minimal tanpa teks. `app.js` hanya menulis
atribut pada elemen yang ada, lalu memancarkan dua event di `document`:

```js
document.addEventListener('access-state', (e) => {
  // e.detail = { state, unlocked, locked, error, reason, perm: { location, camera, microphone } }
})

document.addEventListener('access-recording', (e) => {
  // e.detail = { state: 'idle' | 'recording' | 'stopped' | 'error', durationMs }
})
```

Alternatifnya, styling lewat atribut di `#access-gate` / `#access-status`:
`data-state`, `data-unlocked`, `data-recording`, `data-reason`,
`data-permission-location`, `data-permission-camera`, `data-permission-microphone`.
Ketiganya opsional — hapus elemennya dan logic tetap jalan.

### Uji manual di browser

Buka <http://localhost:3000>, lalu:

| Yang diuji | Cara |
|---|---|
| Semua izin diberikan | Klik "Allow" di ketiga prompt. `data-state` berubah ke `ACCESS_GRANTED`, rekaman mulai sendiri tanpa ada tombol |
| Menolak lokasi | DevTools → Application → Permissions → Geolocation → **Block**, lalu reload. Situs tetap terkunci, mikrofon tidak pernah ditanyakan |
| Menolak kamera | Tolak prompt kamera. Situs terkunci, `#access-retry` muncul |
| Retry | Klik **Coba lagi** setelah memperbaiki izin. Hanya langkah yang gagal yang diulang — izin yang sudah granted tidak di-prompt dua kali |
| Indikator kamera | Ikon kamera di address bar harus menyala selama rekaman, dan ikut mati saat Anda menekan "Stop sharing" di UI browser → `data-state` balik ke `ACCESS_DENIED` |
| Rekaman | Tidak ada tombol: rekaman mulai otomatis di `ACCESS_GRANTED` dan berhenti saat tab ditutup atau track mati |
| Mock Google | Lihat terminal: baris `[mock:sheets] lokasi diterima:` dan `[mock:drive] file diterima:` |

## 8. Troubleshooting

**"Geolocation butuh secure context" / semua izin `Not available`**
Anda membuka lewat `http://192.168.x.x`. Chrome dan Firefox hanya mengizinkan
permission media di `localhost` atau HTTPS. Isi `TLS_CERT_PATH` dan
`TLS_KEY_PATH`, lalu buka `https://localhost:3000`.

**Kamera/mikrofon ditolak dan tidak bisa diminta ulang**
Chrome menyimpan keputusan "deny" sebagai keputusan permanen untuk situs
tersebut. Buka `chrome://settings/content/camera` (atau `mic`) dan hapus
`http://localhost:3000` dari daftar **Not allowed**, lalu reload. Di Firefox:
`about:permissions` → hapus situs.

**Lokasi selalu `POSITION_UNAVAILABLE`**
`enableHighAccuracy: true` butuh sumber lokasi yang benar-benar ada. Coba
kurangi `enableHighAccuracy` di `frontend/location.js` bila hanya ini penyebabnya,
atau aktifkan layanan lokasi di sistem operasi.

**Tidak ada kamera virtual untuk tes**
Chrome flags: `chrome://flags/#use-fake-device-for-media-stream` dan
`#use-fake-ui-for-media-stream`. Lalu pakai deviceId tetap `default`.

**`http://127.0.0.1:3000` tidak bisa lewat CORS**
Tambahkan origin itu ke `ALLOWED_ORIGINS`. Secara default hanya
`http://localhost:3000` dan `http://127.0.0.1:3000` yang diizinkan.

**Upload `413 File exceeds limit`**
Naikkan `MAX_UPLOAD_MB`. File ditahan di memori selama proses upload, jadi
jangan membuat batasnya terlalu besar untuk server.

**Google Sheets `404 NOT_FOUND` / `403 PERMISSION_DENIED`**
Spreadsheet atau folder **belum di-share** ke email service account. Perbaiki
di Google, lalu tunggu beberapa menit. `401` berarti `GOOGLE_PRIVATE_KEY` rusak
— pastikan `\n` ditulis sebagai dua karakter dan tidak ada karakter terpotong.

**`MEDIA_ERR_SRC_NOT_SUPPORTED`**
Shell tidak lagi memuat elemen `<video>`, jadi preview live memang tidak ada.
Kalau Anda menambahkan preview sendiri, ensure `<video>` memakai
`autoplay playsinline muted`.

## Catatan ruang lingkup

Sengaja **tidak** ada: sistem login, konten dan desain website. Yang tersisa
nanti tinggal diisi di dalam `<main id="site">` pada `frontend/index.html`, atau
subscribe ke `access-state`.

Semua secret hanya ada di backend. Tidak ada credential Google, API key, atau
private key yang pernah sampai ke browser, dan tidak ada kode yang memakai
`localStorage` untuk menyimpan kredensial.


