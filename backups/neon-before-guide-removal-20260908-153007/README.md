# Metsu

Aplikasi permainan untuk mengubah keluhan menjadi monster, lalu mengalahkannya dengan klik, sentuhan, keyboard, atau sensor ZIG SIM. Antarmuka tetap menggunakan bahasa Jepang.

## Menjalankan

Dari folder ini jalankan:

```sh
python -m http.server 5501 --bind 127.0.0.1
```

Buka http://127.0.0.1:5501. Bisa juga memakai VS Code Live Server yang sudah dikonfigurasi pada port 5501. Input teks dan pertarungan tidak memerlukan mikrofon atau server sensor. Fitur suara memerlukan izin mikrofon, dukungan pengenalan suara browser, serta koneksi ke layanan eksternal yang digunakan kode awal. Untuk perangkat ZIG SIM, jalankan `server.py` dengan dependensi Python `websockets`; penerima UDP memakai port 50000 dan WebSocket memakai port 8765.

## Tampilan game saat ini

- `index.html` menjadi lobby game: panel misi di kiri, pratinjau monster di tengah, konsol input dan tombol BATTLE START di kanan.
- Logo kanji 滅 dan susunan font versi krem dipertahankan.
- Nuansa gelap dengan neon cyan–ungu, grid perspektif, lingkaran pemanggilan, dan animasi monster yang mengikuti preferensi pengurangan gerakan.
- Pratinjau monster mengikuti klasifikasi teks. Tiga kartu monster menyediakan contoh input; panduan dapat dibuka dari navigasi.
- Pertarungan memakai panel profil target, HP neon, tombol ATTACK, dan penghitung serangan aktual.
- Desain responsif untuk halaman awal, pertarungan, dan hasil.
- Pesan input kosong dan kegagalan tampil di formulir; tombol dikunci selama pemrosesan.
- Pengaturan mikrofon opsional yang dapat dibuka, serta tombol menghentikan mikrofon.
- Serangan melalui tombol native mendukung klik, sentuhan, Enter, dan Space.
- Serangan setelah HP habis diabaikan agar perpindahan monster tidak terpicu berkali-kali.
- Gambar SVG cadangan untuk monster default karena tiga file `nomal*.png` asli kosong. File PNG asli tetap disimpan.

Palet dapat diubah melalui variabel di bagian atas `style.css`:

| Warna | Kode | Kegunaan |
| --- | --- | --- |
| Biru malam | `#080b19` | Latar dunia game |
| Biru gelap | `#0d1528` | Panel antarmuka |
| Cyan neon | `#66e3fa` | HP, bingkai, dan petunjuk |
| Ungu terang | `#b99aff` | Target dan aksen |
| Mint | `#83edc0` | Status siap dan keberhasilan |
| Putih lembut | `#eef2ff` | Teks utama |

## Backup sebelum perubahan

`backups/original-20260908-144801/` berisi salinan 51 file proyek awal, termasuk aset dan `.vscode/settings.json`. Folder internal `.git` tidak disalin. Backup tidak ikut diubah saat versi baru dikerjakan.

`backups/cream-design-20260908-150353/` menyimpan versi desain krem sebelum perubahan menjadi lobby game. Folder ini berisi halaman, skrip, stylesheet, aset, dokumentasi, dan tes pada saat backup. Folder `.git` serta backup lain tidak disalin ulang.

Untuk melihat versi krem, buka http://127.0.0.1:5501/backups/cream-design-20260908-150353/index.html saat server lokal berjalan. Versi awal tersedia di http://127.0.0.1:5501/backups/original-20260908-144801/index.html. Untuk mengembalikan salah satu versi, salin isi folder backup yang dipilih ke folder proyek setelah menyimpan versi baru yang ingin dipertahankan. File tambahan versi baru boleh tetap ada; halaman lama tidak merujuknya.

## Pemeriksaan

```sh
node --test tests/ui-flow.test.cjs
```

Delapan tes memakai simulasi DOM untuk menjalankan skrip asli: input kosong, klasifikasi input teks, gambar cadangan, pratinjau lobby/panduan, pemulihan setelah gagal, suara yang tidak didukung, HP/tombol serangan/penghitung/pergantian monster/replay, serta akses langsung tanpa data. Pemeriksaan struktur HTML juga mencakup ID unik, tautan, aset, viewport, sintaks CSS, dan respons HTTP lokal.

Pemeriksaan visual di browser serta pengujian mikrofon dan perangkat ZIG SIM belum dilakukan dalam sesi ini karena browser pengujian tidak terhubung dan perangkat tidak tersedia.
