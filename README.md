# Metsu

## Menjalankan versi lengkap

Frontend dan backend JavaScript berjalan dari satu server Express dengan SQLite. Tidak memerlukan Python atau ZIG SIM.

```powershell
npm install
npm start
```

Buka `http://127.0.0.1:5501`. Hentikan server lain jika masih memakai port itu, atau pilih port lain:

```powershell
$env:PORT = "5503"
npm start
```

Node.js 20+ diperlukan (pengujian lokal: 20.11.1). `better-sqlite3` adalah modul native; jalankan `npm install` di OS server tujuan. Database dibuat otomatis di `data/metsu.sqlite` dan bertahan setelah restart. Folder `data/` tidak masuk Git. Hosting harus menyediakan disk persisten; implementasi ini untuk satu instance aplikasi.

## Akses HP melalui HTTPS

Sensor dan voice input memerlukan HTTPS. Untuk tunnel, mulai server dengan cookie aman:

```powershell
$env:SECURE_COOKIES = "true"
npm start
```

Di terminal lain:

```powershell
cloudflared tunnel --protocol http2 --url http://127.0.0.1:5501
```

Buka URL HTTPS dari tunnel. Cookie aman tidak dikirim melalui HTTP biasa. Untuk kembali menguji localhost melalui HTTP, set `$env:SECURE_COOKIES = "false"` lalu restart.

| Variabel opsional | Fungsi |
| --- | --- |
| `PORT` | Default 5501 |
| `HOST` | Bind default 127.0.0.1 |
| `METSU_DB` | Lokasi file SQLite |
| `SECURE_COOKIES` | `true` untuk HTTPS di balik proxy/tunnel |
| `PUBLIC_ORIGIN` | Origin publik tetap, misalnya `https://metsu.example.com` |

Gunakan `npm start` untuk semua mode. Tidak ada langkah build demo statis. Server hanya menyajikan file frontend yang diizinkan; database tidak disajikan. Endpoint `/api.js` dibuat oleh server dengan konfigurasi kosong, sehingga file `api.js` lokal tidak diperlukan.

## Alur dan data

1. Pilih tamu, daftar, atau login. Akun memakai username 3–32 karakter dan password minimal 10 karakter, tanpa email.
2. Akun melihat statistik dan riwayat; tamu langsung melihat pilihan mode.
3. Pilih tangan → punch/shake, atau punching bag. Tombol lanjut meminta izin sensor jika browser membutuhkannya. Izin ditolak tetap bisa bermain dengan tap.
4. Akun memberi penilaian stres sendiri 1–5, lalu memasukkan keluhan dan bermain.
5. Setiap monster yang selesai dikalahkan dicatat untuk akun. Tamu tidak mengirim request penyimpanan riwayat.

Satu play dapat berisi beberapa monster. Waktu battle adalah jumlah durasi melawan monster yang selesai, bukan waktu di menu. Battle yang ditinggalkan sebelum monster kalah belum dicatat. Grafik memakai penilaian pengguna satu kali per play, dirata-ratakan per tanggal pada zona waktu browser; bukan inferensi stres dari kekuatan pukulan atau diagnosis kesehatan. Grafik menampilkan maksimal 1.000 play terbaru dengan filter 30/90 hari/semua data itu. Statistik total mencakup semua riwayat; daftar monster dipaginasi 100 baris.

SQLite menyimpan akun (hash scrypt + salt), sesi (hash token), waktu, kategori/jenis/bentuk monster, mode, penilaian stres, durasi, serangan, dan damage. **Isi keluhan dan transkrip suara tidak disimpan di database.** Server mengirim konfigurasi API AI kosong; klasifikasi memakai logika lokal yang sudah ada.

Tamu membawa state sementara di `sessionStorage` untuk perpindahan halaman. Input dan hasil dibuang sesudah hasil ditampilkan atau saat kembali ke dashboard. Tidak ada arsip gameplay atau kamus koreksi ucapan untuk tamu. Pengaturan audio yang sudah ada terpisah dari riwayat gameplay; fitur ini tidak menghapus riwayat URL milik browser.

Jika koneksi gagal, UI menandai hasil belum tersimpan dan menyediakan retry. Dashboard juga mencoba mengirim antrean sementara dari tab yang sama. Jangan menutup tab sebelum selesai menyimpan. Pengulangan request tidak menggandakan data, dan antrean hanya bisa dikirim untuk akun pemiliknya. Logout membuang antrean setelah konfirmasi bila masih ada data tertunda.

Menu manajemen riwayat dapat menghapus semua riwayat akun sendiri dengan konfirmasi. Pemulihan password dan verifikasi email belum tersedia. Untuk backup lokal, hentikan server dahulu lalu salin folder `data/` ke lokasi aman. Jangan membagikan database.

## Deteksi gerakan

- Punch: kalibrasi diam 0,8 detik, satu pulsa percepatan, lalu harus tenang sebelum hit berikutnya. Cooldown 450 ms.
- Shake: dua puncak berlawanan pada sumbu yang sama, bukan satu guncangan. Cooldown 400 ms.
- Punching bag: mempertahankan detektor lama (gravitasi, gyro, kalibrasi 1,5 detik, rentang ayunan).
- Semua mode mendukung tap. Gerakkan HP ringan dengan pegangan aman. Sensor membaca HP yang membuka halaman, bukan perangkat kedua.

Ambang punch/shake diuji dengan sampel sintetis. Sensitivitas masih perlu diuji pada HP dan pemasangan bag yang sebenarnya.

## Pengujian

```powershell
npm test
npm run test:browser
```

Tes browser memakai Edge pada Windows. Pada OS lain, jalankan `npx playwright install chromium` dahulu. `BROWSER_CHANNEL` dapat memilih browser. Tes memakai database terpisah/in-memory, tidak menyentuh data pengguna. Cakupan: autentikasi, isolasi akun, persistensi SQLite, validasi/CSRF, guest tanpa riwayat, retry tanpa duplikat, sensor, mode, dan layout delapan lebar layar.

## Struktur dan penggunaan proyek

Jalankan perintah dari folder Metsu. Setelah `npm install` berhasil, penggunaan berikutnya cukup `npm start`. Biarkan terminal berjalan; tekan Ctrl+C untuk berhenti. Gunakan URL server, bukan Live Server atau membuka HTML langsung.

- `server.cjs`: backend web, akun, dan riwayat SQLite.
- `index.html`, `battle.html`, `result.html`: halaman aplikasi.
- File JavaScript dan CSS: alur permainan, klasifikasi lokal, suara, sensor, dan tampilan.
- `assets/`: gambar, termasuk variasi monster berdasarkan HP dan bentuk.
- `tests/`: pengujian otomatis.
- `package.json`, `package-lock.json`: perintah dan dependensi Node.js.
- `data/`: akun dan riwayat lokal; jangan dihapus jika data masih diperlukan.

Jika muncul `EADDRINUSE`, hentikan server lain atau ubah `PORT`. Jika tunnel menampilkan 502, pastikan server berjalan dan port tunnel sama dengan server. Untuk akses HP, biarkan server dan tunnel berjalan, lalu buka URL HTTPS tunnel di HP. Sensor dan mikrofon tetap bergantung pada izin dan dukungan perangkat/browser; tap tersedia sebagai alternatif.