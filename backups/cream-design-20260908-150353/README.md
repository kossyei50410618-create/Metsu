# Metsu

Aplikasi permainan untuk mengubah keluhan menjadi monster, lalu mengalahkannya dengan klik, sentuhan, keyboard, atau sensor ZIG SIM. Antarmuka tetap menggunakan bahasa Jepang.

## Menjalankan

Dari folder ini jalankan:

```sh
python -m http.server 5501 --bind 127.0.0.1
```

Buka http://127.0.0.1:5501. Bisa juga memakai VS Code Live Server yang sudah dikonfigurasi pada port 5501. Input teks dan pertarungan tidak memerlukan mikrofon atau server sensor. Fitur suara memerlukan izin mikrofon, dukungan pengenalan suara browser, serta koneksi ke layanan eksternal yang digunakan kode awal. Untuk perangkat ZIG SIM, jalankan `server.py` dengan dependensi Python `websockets`; penerima UDP memakai port 50000 dan WebSocket memakai port 8765.

## Pembaruan tampilan

- Halaman awal dengan penjelasan aplikasi, panduan tiga langkah, dan contoh isian.
- Desain responsif untuk halaman awal, pertarungan, dan hasil.
- Pesan input kosong dan kegagalan tampil di formulir; tombol dikunci selama pemrosesan.
- Pengaturan mikrofon opsional yang dapat dibuka, serta tombol menghentikan mikrofon.
- Serangan melalui tombol native mendukung klik, sentuhan, Enter, dan Space.
- Serangan setelah HP habis diabaikan agar perpindahan monster tidak terpicu berkali-kali.
- Gambar SVG cadangan untuk monster default karena tiga file `nomal*.png` asli kosong. File PNG asli tetap disimpan.

Palet dapat diubah melalui variabel di bagian atas `style.css`:

| Warna | Kode | Kegunaan |
| --- | --- | --- |
| Krem | `#f7f6f2` | Latar halaman |
| Ungu | `#6850ce` | Tombol utama dan aksen |
| Lavender | `#eae5fa` | Bagian pendukung |
| Mint | `#d5f3dc` | Aksen positif |
| Arang ungu | `#292638` | Teks utama |

## Backup sebelum perubahan

`backups/original-20260908-144801/` berisi salinan 51 file proyek awal, termasuk aset dan `.vscode/settings.json`. Folder internal `.git` tidak disalin. Backup tidak ikut diubah saat versi baru dikerjakan.

Untuk melihat versi lama, buka http://127.0.0.1:5501/backups/original-20260908-144801/index.html saat server lokal berjalan. Untuk mengembalikan versi lama, salin isi folder backup ke folder proyek setelah menyimpan versi baru yang ingin dipertahankan. File tambahan versi baru boleh tetap ada; halaman lama tidak merujuknya.

## Pemeriksaan

```sh
node --test tests/ui-flow.test.cjs
```

Tes memakai simulasi DOM untuk menjalankan skrip asli: input kosong, klasifikasi input teks, gambar cadangan, pemulihan setelah gagal, suara yang tidak didukung, HP/pergantian monster/replay, serta akses langsung tanpa data. Pemeriksaan struktur HTML juga mencakup ID unik, tautan, aset, viewport, dan respons HTTP lokal.

Pemeriksaan visual di browser serta pengujian mikrofon dan perangkat ZIG SIM belum dilakukan dalam sesi ini karena browser pengujian tidak terhubung dan perangkat tidak tersedia.
