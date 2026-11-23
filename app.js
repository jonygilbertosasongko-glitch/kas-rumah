/*
 * Kas Rumah — aplikasi buku kas keluarga untuk iPhone (PWA).
 *
 * Semua angka dihitung server (Google Apps Script, Code.gs) dengan rumus yang
 * sama dengan dashboard dan bot Telegram. Aplikasi ini menampilkan, mencatat
 * lewat Google Form yang sama, menyimpan salinan terakhir untuk dibuka tanpa
 * sinyal, dan mengirim ulang catatan yang tertunda.
 */
(function () {
  'use strict';

  var VERSI_APP = '2026.11.23';
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September',
    'Oktober', 'November', 'Desember'];
  var BULAN3 = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var PILAR = ['Wajib', 'Kebutuhan', 'Fleksibel'];
  var JENIS_MASUK = ['Gaji', 'Bonus Tahunan', 'Dividen Saham', 'Uang Cuti', 'THR'];

  var layar = document.getElementById('layar');
  var tabBar = document.querySelector('.tab');

  // ================================================================ util
  var simpan = {
    baca: function (k, cadangan) {
      try { var v = localStorage.getItem('kas.' + k); return v ? JSON.parse(v) : cadangan; }
      catch (e) { return cadangan; }
    },
    tulis: function (k, v) { try { localStorage.setItem('kas.' + k, JSON.stringify(v)); } catch (e) { /* penuh/privat */ } },
    hapus: function (k) { try { localStorage.removeItem('kas.' + k); } catch (e) { /* abaikan */ } }
  };

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var hx = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return hx.slice(0, 8) + '-' + hx.slice(8, 12) + '-' + hx.slice(12, 16) + '-' + hx.slice(16, 20) + '-' + hx.slice(20);
  }

  /** Buat elemen. Teks selalu lewat textContent, tidak pernah innerHTML. */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
        else if (k === 'style') el.setAttribute('style', v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) tambahAnak(el, arguments[i]);
    return el;
  }
  function tambahAnak(el, a) {
    if (a === null || a === undefined || a === false) return;
    if (Array.isArray(a)) { a.forEach(function (x) { tambahAnak(el, x); }); return; }
    el.appendChild(a.nodeType ? a : document.createTextNode(String(a)));
  }

  var SVG = {
    muat: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>',
    kiri: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    kanan: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    bagikan: '<svg viewBox="0 0 24 24" class="ikon-bagikan"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8"/></svg>'
  };
  function ikon(nama) { var s = document.createElement('span'); s.innerHTML = SVG[nama]; return s.firstChild; }

  var angkaID = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
  function rp(v) { return (v < 0 ? '-' : '') + 'Rp\u00a0' + angkaID.format(Math.abs(Math.round(v || 0))); }
  /** Bentuk pendek seperti di laporan: Rp 350 rb, Rp 1,2 jt, Rp 1,5 M. */
  function bagianRp(v) {
    var a = Math.abs(v || 0);
    function d(x, n) {
      var s = x.toFixed(n);
      if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
      return s.replace('.', ',');
    }
    if (Math.round(a / 1e7) / 100 >= 1) return { angka: d(a / 1e9, 2), satuan: 'M' };
    if (Math.round(a / 1e5) / 10 >= 1000) return { angka: d(a / 1e9, 2), satuan: 'M' };
    if (Math.round(a / 1e5) / 10 >= 1) return { angka: d(a / 1e6, 1), satuan: 'jt' };
    if (Math.round(a / 1e3) >= 1000) return { angka: d(a / 1e6, 1), satuan: 'jt' };
    if (a >= 1e3) return { angka: d(a / 1e3, 0), satuan: 'rb' };
    return { angka: d(a, 0), satuan: '' };
  }
  var NB = '\u00a0';
  function rpS(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var b = bagianRp(v);
    return (v < 0 ? '-' : '') + 'Rp' + NB + b.angka + (b.satuan ? NB + b.satuan : '');
  }
  /** Teks dari server: jangan biarkan "Rp 32 rb" terpotong di ujung baris. */
  function rapi(teks) {
    return String(teks || '').replace(/Rp (\S+) (rb|jt|M)\b/g, 'Rp' + NB + '$1' + NB + '$2').replace(/Rp (\d)/g, 'Rp' + NB + '$1');
  }
  function tglPanjang(iso) { var a = String(iso).split('-').map(Number); return a[2] + ' ' + BULAN[a[1] - 1] + ' ' + a[0]; }
  function persen(p) { return (p === null || p === undefined || !isFinite(p)) ? '—' : Math.round(p * 100) + '%'; }
  function tglPendek(iso) { var a = iso.split('-').map(Number); return a[2] + ' ' + BULAN3[a[1] - 1]; }
  function namaSiklus(kode) { var a = kode.split('-').map(Number); return BULAN[a[1] - 1] + ' ' + a[0]; }
  function jamDari(ms) {
    var d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + '.' + String(d.getMinutes()).padStart(2, '0');
  }
  function waktuRelatif(ms) {
    var detik = Math.round((Date.now() - ms) / 1000);
    if (detik < 60) return 'baru saja';
    if (detik < 3600) return Math.floor(detik / 60) + ' menit lalu';
    var d = new Date(ms), kini = new Date();
    if (d.toDateString() === kini.toDateString()) return 'pukul ' + jamDari(ms);
    return d.getDate() + ' ' + BULAN3[d.getMonth()] + ' pukul ' + jamDari(ms);
  }
  function angkaDari(s) { var n = parseInt(String(s || '').replace(/\D/g, ''), 10); return isFinite(n) ? n : 0; }
  function formatNominal(s) { var n = angkaDari(s); return n ? angkaID.format(n) : ''; }
  function siklusGeser(kode, n) {
    var a = kode.split('-').map(Number), p = a[0] * 12 + a[1] - 1 + n;
    return Math.floor(p / 12) + '-' + String(p % 12 + 1).padStart(2, '0');
  }

  var kabarTimer = null;
  function kabar(teks) {
    var wadah = document.getElementById('kabar');
    wadah.textContent = '';
    wadah.appendChild(h('div', { class: 'isi-kabar' }, teks));
    clearTimeout(kabarTimer);
    kabarTimer = setTimeout(function () { wadah.textContent = ''; }, 3600);
  }

  function iOS() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function modeAplikasi() {
    return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }

  // ================================================================ keadaan
  var S = {
    konfig: simpan.baca('konfig', null),
    perangkat: simpan.baca('perangkat', null),
    data: simpan.baca('data', null),
    kamus: simpan.baca('kamus', null),
    model: null,
    antre: simpan.baca('antre', []),
    gagal: simpan.baca('gagal', []),
    memuat: false,
    mengirim: false,
    galat: null,
    riwayat: { siklus: null, cari: '', data: {} },
    posTerbuka: null,
    catat: null,
    hasilCatat: null,
    notif: { status: 'periksa', sub: null },
    lewatiPasangIos: false,
    perluMuatUlang: false
  };
  if (!S.perangkat) { S.perangkat = { id: uuid(), nama: '' }; simpan.tulis('perangkat', S.perangkat); }
  if (S.kamus && window.Saran) S.model = Saran.siapkan(S.kamus.data);

  function simpanAntre() { simpan.tulis('antre', S.antre); simpan.tulis('gagal', S.gagal); }

  // ================================================================ pasang
  function b64uKeTeks(s) {
    s = String(s).trim().replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(b);
  }
  var POLA_API = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^\/]+|macros)\/s\/[\w-]+\/exec$/;
  var POLA_API_UJI = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/[\w\/-]*$/;
  function bacaKodePasang(kode) {
    try {
      var j = JSON.parse(b64uKeTeks(kode));
      if (!j || typeof j.api !== 'string' || !j.kunci) return null;
      if (!POLA_API.test(j.api) && !POLA_API_UJI.test(j.api)) return null;
      return { api: j.api, kunci: String(j.kunci), t: Number(j.t) || 0 };
    } catch (e) { return null; }
  }
  function simpanKonfig(k) {
    S.konfig = k;
    simpan.tulis('konfig', k);
    salinKonfigKeSw();
  }
  /** Service worker tidak bisa membaca localStorage, jadi salinannya ditaruh di Cache Storage. */
  function salinKonfigKeSw() {
    if (!S.konfig || !window.caches) return;
    var isi = JSON.stringify({ api: S.konfig.api, kunci: S.konfig.kunci, perangkat: S.perangkat.id });
    caches.open('kas-konfig').then(function (c) {
      return c.put('./__konfig', new Response(isi, { headers: { 'Content-Type': 'application/json' } }));
    }).catch(function () { /* mode privat */ });
  }
  function terapkanKodeDariUrl() {
    var q = new URLSearchParams(location.search), kode = q.get('pasang');
    if (!kode) return;
    var k = bacaKodePasang(kode);
    if (k && (!S.konfig || k.t > (S.konfig.t || 0) || k.api !== S.konfig.api)) {
      simpanKonfig(k);
      S.data = null; simpan.hapus('data');
    }
    // Di Safari biasa, query dibiarkan: ikon Layar Utama mengambil alamat ini
    // apa adanya, dan aplikasi di Layar Utama punya penyimpanan sendiri.
    if (modeAplikasi() || !iOS()) history.replaceState(null, '', location.pathname + location.hash);
  }

  // ================================================================ API
  function GalatApi(pesan, kode) { this.message = pesan; this.kode = kode; }
  GalatApi.prototype = Object.create(Error.prototype);

  function panggil(aksi, data, opsi) {
    opsi = opsi || {};
    var k = S.konfig;
    if (!k) return Promise.reject(new GalatApi('Aplikasi belum dipasang.', 'KONFIG'));
    var badan = Object.assign({}, data || {}, { aksi: aksi, kunci: k.kunci });
    var ctrl = window.AbortController ? new AbortController() : null;
    var batas = setTimeout(function () { if (ctrl) ctrl.abort(); }, opsi.batas || 30000);
    var req;
    if (opsi.metode === 'GET') {
      var q = new URLSearchParams();
      Object.keys(badan).forEach(function (x) { if (badan[x] !== undefined && badan[x] !== '') q.set(x, badan[x]); });
      req = fetch(k.api + '?' + q.toString(), { signal: ctrl && ctrl.signal, redirect: 'follow', cache: 'no-store' });
    } else {
      req = fetch(k.api, { method: 'POST', body: JSON.stringify(badan), signal: ctrl && ctrl.signal, redirect: 'follow',
        cache: 'no-store', headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    }
    return req.then(function (res) { return res.text(); }, function () {
      throw new GalatApi(navigator.onLine === false ? 'Tidak ada sinyal internet.' :
        'Server tidak terjangkau. Coba lagi sebentar lagi.', 'JARINGAN');
    }).then(function (teks) {
      var j;
      try { j = JSON.parse(teks); }
      catch (e) { throw new GalatApi('Balasan server tidak terbaca. Pastikan Web App di-deploy dengan akses "Anyone".', 'FORMAT'); }
      if (!j.ok) throw new GalatApi(j.galat || 'Permintaan ditolak server.', j.kode || 'GALAT');
      return j.data;
    }).finally(function () { clearTimeout(batas); });
  }

  // ================================================================ data
  function muatData(opsi) {
    opsi = opsi || {};
    if (!S.konfig || S.memuat) return Promise.resolve();
    var perluKamus = opsi.kamus || !S.kamus || (Date.now() - S.kamus.waktu > 86400000);
    S.memuat = true;
    tandaiMemuat();
    return panggil('muat', { perangkat: S.perangkat.id, kamus: perluKamus ? '1' : '' }, { metode: 'GET', batas: 50000 })
      .then(function (d) {
        if (d.kamus) {
          S.kamus = { data: d.kamus, waktu: Date.now() };
          simpan.tulis('kamus', S.kamus);
          if (window.Saran) S.model = Saran.siapkan(d.kamus);
          delete d.kamus;
        }
        d.waktu = Date.now();
        S.data = d;
        simpan.tulis('data', d);
        S.galat = null;
        S.riwayat.data = {};
        perbaruiLencana();
        if (opsi.dariPengguna) kabar('Data diperbarui.');
      }, function (e) {
        S.galat = e;
        if (opsi.dariPengguna) kabar(e.message);
      }).then(function () {
        S.memuat = false;
        tandaiMemuat();
        render({ data: true });
        periksaNotif();
      });
  }
  function tandaiMemuat() {
    var t = document.querySelector('[data-muat]');
    if (t) t.classList.toggle('berputar', S.memuat);
  }
  function R() { return S.data && S.data.ringkasan; }

  function perbaruiLencana() {
    var r = R();
    if (!r || !navigator.setAppBadge || !('Notification' in window) || Notification.permission !== 'granted') return;
    var n = r.pos.filter(function (p) { return p.status === 'lewat'; }).length;
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(function () { /* tidak didukung */ });
  }

  // ================================================================ antrean catat
  function kirimAntre() {
    if (S.mengirim || !S.antre.length || !S.konfig) return Promise.resolve();
    S.mengirim = true;
    function satu() {
      if (!S.antre.length) return Promise.resolve();
      var item = S.antre[0];
      var badan = Object.assign({}, item.isian, { id: item.id, perangkat: S.perangkat.id, nama: S.perangkat.nama });
      return panggil('catat', badan, { batas: 60000 }).then(function (hasil) {
        S.antre.shift();
        simpanAntre();
        if (hasil.ringkasan && S.data) {
          S.data.ringkasan = hasil.ringkasan; S.data.waktu = Date.now();
          simpan.tulis('data', S.data);
          S.riwayat.data = {};
          perbaruiLencana();
        }
        if (S.hasilCatat && S.hasilCatat.id === item.id) S.hasilCatat = { id: item.id, keadaan: 'terkirim', item: item, hasil: hasil };
        else kabar('Terkirim: ' + ringkasIsian(item.isian));
        return satu();
      }, function (e) {
        if (e.kode === 'ISIAN') {
          // Ditolak karena isinya (mis. pilihan tidak ada di form): jangan diulang terus.
          S.antre.shift();
          item.galat = e.message;
          S.gagal.push(item);
          simpanAntre();
          if (S.hasilCatat && S.hasilCatat.id === item.id) S.hasilCatat = { id: item.id, keadaan: 'ditolak', item: item, galat: e.message };
          return satu();
        }
        // Jaringan, kunci, atau server sibuk: simpan dan coba lagi nanti.
        if (S.hasilCatat && S.hasilCatat.id === item.id) S.hasilCatat = { id: item.id, keadaan: 'tertunda', item: item, galat: e.message };
        throw e;
      });
    }
    return satu().catch(function () { /* dicoba lagi saat online / aplikasi dibuka */ })
      .then(function () { S.mengirim = false; render({ data: true }); });
  }
  function ringkasIsian(x) {
    return (x.tipe === 'Pengeluaran' ? x.kategori : (x.jenis_masuk || 'Pemasukan')) + ' ' + rpS(x.nominal);
  }
  setInterval(function () { if (document.visibilityState === 'visible' && S.antre.length) kirimAntre(); }, 30000);

  // ================================================================ navigasi
  var TAB = ['ringkas', 'pos', 'catat', 'riwayat', 'atur'];
  function tabKini() {
    var t = (location.hash || '#ringkas').slice(1);
    return TAB.indexOf(t) >= 0 ? t : 'ringkas';
  }
  var tabTerakhir = null;
  function render(opsi) {
    opsi = opsi || {};
    if (!S.konfig) { tampil(layarPasang(), false); return; }
    if (iOS() && !modeAplikasi() && !S.lewatiPasangIos) { tampil(layarPasangIos(), false); return; }
    var tab = tabKini();
    // Form catat tidak dibangun ulang saat data datang supaya isian & fokus tidak hilang.
    if (opsi.data && tab === 'catat' && tabTerakhir === 'catat' && !S.hasilCatat && document.getElementById('form-catat')) {
      perbaruiSaran();
      perbaruiInfoAntre();
      return;
    }
    var bangun = { ringkas: layarRingkas, pos: layarPos, catat: layarCatat, riwayat: layarRiwayat, atur: layarAtur }[tab];
    var gulir = window.scrollY;
    tampil(bangun(), true);
    if (opsi.data && tab === tabTerakhir) window.scrollTo(0, gulir);
    else if (tab !== tabTerakhir) window.scrollTo(0, 0);
    tabTerakhir = tab;
    Array.prototype.forEach.call(tabBar.querySelectorAll('a'), function (a) {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function tampil(isi, denganTab) {
    layar.textContent = '';
    layar.appendChild(isi);
    tabBar.hidden = !denganTab;
    layar.classList.toggle('tanpa-tab', !denganTab);
  }
  window.addEventListener('hashchange', function () {
    if (tabKini() !== 'catat') S.hasilCatat = null;
    render();
  });

  // ================================================================ layar: pasang
  function layarPasang() {
    var galat = h('p', { class: 'galat', role: 'alert' });
    var area = h('textarea', { class: 'masukan', id: 'kode-pasang', rows: '4', autocapitalize: 'off', autocomplete: 'off',
      spellcheck: 'false', 'aria-describedby': 'bantu-kode' });
    var tombol = h('button', { class: 'tombol utama penuh', type: 'submit' }, 'Pasang');
    function pasang(ev) {
      ev.preventDefault();
      var k = bacaKodePasang(area.value);
      galat.textContent = '';
      if (!k) { galat.textContent = 'Kode tidak dikenali. Salin ulang seluruh kode dari tautanPasang(), tanpa spasi tambahan.'; area.setAttribute('aria-invalid', 'true'); return; }
      tombol.disabled = true; tombol.classList.add('memuat');
      var lama = S.konfig;
      S.konfig = k;
      panggil('ping', {}, { metode: 'GET', batas: 30000 }).then(function () {
        simpanKonfig(k);
        S.data = null; simpan.hapus('data');
        muatData();
        render();
      }, function (e) {
        S.konfig = lama;
        tombol.disabled = false; tombol.classList.remove('memuat');
        galat.textContent = e.kode === 'KUNCI' ? 'Kodenya lama. Jalankan tautanPasang() lagi di Apps Script lalu tempel kode barunya.' : e.message;
      });
    }
    return h('form', { class: 'pasang', onsubmit: pasang },
      h('div', { class: 'merek' }, h('img', { src: 'ikon/ikon-192.png', alt: '' }), h('h1', null, 'Kas Rumah')),
      h('p', { class: 'teks' }, 'Sisa jatah belanja tiap siklus gajian, pos yang lewat jatah, dan catat belanja dari HP. Datanya tetap di Google Sheet yang sama.'),
      h('div', { class: 'isian' },
        h('label', { for: 'kode-pasang' }, 'Kode pasang'),
        area,
        h('p', { class: 'bantu', id: 'bantu-kode' }, 'Paling mudah buka tautan pasang dari laptop di HP ini. Kalau tidak bisa, jalankan tautanPasang() di Apps Script lalu tempel kodenya di sini.'),
        galat),
      h('div', { class: 'kirim' }, tombol));
  }

  function layarPasangIos() {
    return h('div', { class: 'pasang' },
      h('div', { class: 'merek' }, h('img', { src: 'ikon/ikon-192.png', alt: '' }), h('h1', null, 'Tinggal satu langkah')),
      h('p', { class: 'teks' }, 'Kas Rumah sudah tersambung ke catatanmu. Supaya bisa dibuka seperti aplikasi dan menerima notifikasi, tambahkan ke Layar Utama.'),
      h('ol', { class: 'langkah-pasang' },
        h('li', null, h('span', null, 'Ketuk tombol Bagikan ', ikon('bagikan'), ' di bilah Safari.')),
        h('li', null, h('span', null, 'Pilih "Tambah ke Layar Utama" (Add to Home Screen), lalu Tambah.')),
        h('li', null, h('span', null, 'Buka Kas Rumah dari ikon barunya. Notifikasi diaktifkan dari sana.'))),
      h('div', { class: 'kirim' },
        h('button', { class: 'tombol penuh', type: 'button', onclick: function () { S.lewatiPasangIos = true; render(); } }, 'Lihat dulu di Safari')));
  }

  // ================================================================ layar: ringkas
  function kepala(judul, sub, denganMuat) {
    return h('header', { class: 'kepala' },
      h('div', null, h('h1', null, judul), sub ? h('p', { class: 'sub' }, sub) : null),
      denganMuat ? h('button', { class: 'tombol-ikon' + (S.memuat ? ' berputar' : ''), type: 'button', 'data-muat': '',
        'aria-label': 'Muat ulang data', onclick: function () { kirimAntre(); muatData({ dariPengguna: true }); } }, ikon('muat')) : null);
  }
  function kerangka() {
    return h('div', { class: 'kerangka', 'aria-label': 'Memuat data' }, h('i', { class: 'besar' }), h('i'), h('i'), h('i'));
  }
  function infoSegar() {
    var d = S.data;
    if (!d) return null;
    var teks = 'Diperbarui ' + waktuRelatif(d.waktu) + '.';
    if (S.galat) {
      return h('div', { class: 'pita peringatan', role: 'alert' },
        h('span', null, h('strong', null, 'Belum bisa memperbarui. '), S.galat.message + ' Yang tampil adalah data ' + waktuRelatif(d.waktu) + '.'),
        h('button', { class: 'tombol kecil', type: 'button', onclick: function () { muatData({ dariPengguna: true }); } }, 'Coba lagi'));
    }
    return h('p', { class: 'kecil', style: 'margin-top:22px' }, teks);
  }

  function pitaAntre() {
    var out = [];
    if (S.antre.length) {
      out.push(h('div', { class: 'pita' },
        h('span', null, h('strong', null, S.antre.length + ' catatan belum terkirim. '), 'Dikirim otomatis saat ada sinyal.'),
        h('button', { class: 'tombol kecil', type: 'button', onclick: function () { kirimAntre(); } }, 'Kirim')));
    }
    if (S.gagal.length) {
      out.push(h('div', { class: 'pita peringatan' },
        h('span', null, h('strong', null, S.gagal.length + ' catatan ditolak. '), 'Perlu diperbaiki sebelum dikirim ulang.'),
        h('a', { class: 'tombol kecil', href: '#riwayat' }, 'Lihat')));
    }
    return out;
  }

  function kartuSambut() {
    if (!modeAplikasi() && iOS()) return null;
    if (!S.perangkat.nama) {
      var masukan = h('input', { class: 'masukan', placeholder: 'Nama lain', 'aria-label': 'Nama pemakai HP', autocapitalize: 'words',
        onkeydown: function (e) { if (e.key === 'Enter' && masukan.value.trim()) pilih(masukan.value.trim()); } });
      function pilih(nama) { S.perangkat.nama = nama.slice(0, 30); simpan.tulis('perangkat', S.perangkat); salinKonfigKeSw(); render(); }
      return h('div', { class: 'pita', style: 'grid-template-columns:1fr' },
        h('span', null, h('strong', null, 'Siapa yang memakai HP ini? '), 'Namanya muncul di notifikasi untuk anggota keluarga lain.'),
        h('div', { class: 'chip-grup' },
          h('button', { class: 'chip', type: 'button', onclick: function () { pilih('Ayah'); } }, 'Ayah'),
          h('button', { class: 'chip', type: 'button', onclick: function () { pilih('Mama'); } }, 'Mama')),
        masukan);
    }
    if (S.notif.status === 'belum' && !simpan.baca('tolakNotif', false)) {
      return h('div', { class: 'pita' },
        h('span', null, h('strong', null, 'Aktifkan notifikasi '), 'supaya dapat kabar saat ada pos yang lewat jatah.'),
        h('div', { class: 'chip-grup' },
          h('button', { class: 'tombol kecil utama', type: 'button', onclick: function (e) { aktifkanNotif(e.currentTarget); } }, 'Aktifkan'),
          h('button', { class: 'tautan', type: 'button', onclick: function () { simpan.tulis('tolakNotif', true); render(); } }, 'Nanti')));
    }
    if (S.notif.status === 'sinkron-gagal') {
      return h('div', { class: 'pita peringatan' }, h('span', null, 'Notifikasi di HP ini perlu diaktifkan ulang.'),
        h('a', { class: 'tombol kecil', href: '#atur' }, 'Buka Atur'));
    }
    return null;
  }

  var sudahAnimasi = false;
  function layarRingkas() {
    var r = R();
    if (!r) {
      return h('div', null, kepala('Kas Rumah', 'Mengambil data dari Google Sheet', true),
        S.galat ? h('div', { class: 'kosong' }, h('h2', null, 'Data belum bisa diambil'), h('p', { class: 'teks' }, S.galat.message),
          h('div', { class: 'kirim' }, h('button', { class: 'tombol', type: 'button', onclick: function () { muatData({ dariPengguna: true }); } }, 'Coba lagi')))
          : kerangka());
    }
    var s = r.status, b = r.belanja;
    var sub = tglPendek(r.siklus.awal) + ' – ' + tglPendek(r.siklus.akhir) + ', hari ke-' + s.hari_ke + ' dari ' + s.hari_total;
    var sisaHari = s.hari_total - s.hari_ke;
    var lewat = b.sisa < 0;
    var angka = bagianRp(Math.abs(b.sisa));
    var jelas = lewat ?
      'lewat dari jatah belanja ' + rpS(b.jatah) + ', gajian ' + sisaHari + ' hari lagi.' :
      (b.jatah > 0 ? 'sisa jatah belanja untuk ' + sisaHari + ' hari, sekitar ' + rpS(s.batas_harian) + ' per hari.' : 'belum ada jatah belanja.');
    var pw = s.porsi_waktu, pu = s.porsi_jatah === null ? 0 : s.porsi_jatah;
    var kelasUang = s.kode === 'jebol' ? 'jebol' : (s.kode === 'waspada' ? 'waspada' : '');

    var pokok = h('section', { class: 'pokok' + (sudahAnimasi ? '' : ' mulai-isi'), 'aria-label': 'Sisa jatah belanja' },
      h('p', { class: 'angka-besar' + (lewat ? ' lewat' : '') },
        h('span', { class: 'satuan', style: 'margin:0 4px 0 0' }, 'Rp'), angka.angka,
        angka.satuan ? h('span', { class: 'satuan' }, angka.satuan) : null),
      h('p', { class: 'jelas' }, jelas),
      h('div', { class: 'lintasan' },
        h('div', { class: 'lintas', role: 'img', 'aria-label': 'Waktu siklus berjalan ' + persen(pw) },
          h('span', { class: 'nama' }, 'Waktu'),
          h('div', { class: 'rel' }, h('div', { class: 'isi', style: 'width:' + Math.min(pw, 1) * 100 + '%' })),
          h('span', { class: 'nilai' }, persen(pw))),
        h('div', { class: 'lintas uang ' + kelasUang, role: 'img', 'aria-label': 'Jatah belanja terpakai ' + persen(pu) },
          h('span', { class: 'nama' }, 'Uang'),
          h('div', { class: 'rel' + (pu > 1 ? ' lebih' : '') },
            h('div', { class: 'isi', style: 'width:' + Math.min(pu, 1) * 100 + '%' }),
            h('div', { class: 'tanda', style: 'left:' + Math.min(pw, 1) * 100 + '%', title: 'Posisi hari ini' })),
          h('span', { class: 'nilai' + (pu > 1 ? ' merah' : '') }, persen(pu)))),
      h('p', { class: 'lintas-ket' }, 'Titik menandai hari ini. Uang yang melewatinya berarti belanja lebih cepat dari waktu.'),
      h('div', { class: 'status ' + s.kode },
        h('p', { class: 'judul' }, h('span', null, s.judul)),
        h('p', { class: 'langkah' }, rapi(s.langkah))));
    sudahAnimasi = true;

    var perhatian = r.pos.filter(function (p) { return p.status === 'lewat' || p.status === 'akan_lewat'; });
    var bagPerhatian = h('section', { class: 'bagian' },
      h('h2', null, perhatian.length ? 'Perlu perhatian' : 'Semua pos masih dalam jatah'),
      perhatian.length ? h('ul', { class: 'buku' }, perhatian.map(function (p) {
        var detail;
        if (p.status === 'lewat') detail = 'lewat ' + rpS(p.terpakai - p.jatah) + ' dari jatah ' + rpS(p.jatah);
        else if (p.alasan === 'proyeksi') detail = 'kalau lajunya tetap jadi ' + rpS(p.proyeksi) + ', jatahnya ' + rpS(p.jatah);
        else detail = 'sudah ' + persen(p.rasio) + ' dari jatah ' + rpS(p.jatah);
        return h('li', null, h('a', { class: 'baris', href: '#pos', onclick: function () { S.posTerbuka = p.nama; },
          style: 'text-decoration:none' },
          h('span', { class: 'nama' }, p.status === 'lewat' ? h('span', { class: 'pena-merah' }, p.nama) : h('mark', { class: 'stabilo' }, p.nama)),
          h('span', { class: 'jumlah' + (p.status === 'lewat' ? ' merah' : '') }, rpS(p.terpakai)),
          h('span', { class: 'detail' }, detail)));
      })) : h('p', { class: 'teks' }, 'Tidak ada pos yang lewat atau mendekati jatahnya.'));

    var am = r.amplop, bagAmplop = null;
    if (am) {
      var pa = am.porsi === null ? 0 : am.porsi;
      bagAmplop = h('section', { class: 'bagian' },
        h('h2', null, 'Amplop istri'),
        h('div', { class: 'baris', style: 'padding-top:0' },
          h('span', { class: 'nama' }, rpS(am.terpakai) + ' dari ' + rpS(am.jatah)),
          h('span', { class: 'jumlah' + (am.sisa < 0 ? ' merah' : '') }, am.sisa < 0 ? 'lewat ' + rpS(-am.sisa) : 'sisa ' + rpS(am.sisa)),
          h('div', { class: 'bar ' + (pa >= 1 ? 'lewat' : (pa >= 0.85 ? 'akan_lewat' : '')), role: 'img', 'aria-label': 'Amplop terpakai ' + persen(pa) },
            h('div', { class: 'isi', style: 'width:' + Math.min(pa, 1) * 100 + '%' }),
            h('div', { class: 'waktu', style: 'left:' + Math.min(pw, 1) * 100 + '%' })),
          h('span', { class: 'detail' }, 'Belanja ' + am.siapa.join(', ') + '. ' +
            (am.bulan_berisi ? 'Rata-rata ' + am.bulan_berisi + ' bulan terakhir ' + rpS(am.rata_rata) + (am.bulan_lewat ? ', lewat jatah ' + am.bulan_lewat + ' kali.' : '.') : ''))));
    }

    var bagCatatan = (s.catatan && s.catatan.length) ? h('section', { class: 'bagian' },
      h('h2', null, 'Catatan'), h('div', { class: 'catatan' }, s.catatan.map(function (c) { return h('p', null, rapi(c)); }))) : null;

    var kotak = (S.data.kotak || []).slice(0, 3);
    var bagKabar = kotak.length ? h('section', { class: 'bagian kotak-pesan' },
      h('h2', null, 'Notifikasi terakhir'),
      kotak.map(function (p) {
        return h('div', { class: 'pesan' }, h('h3', null, p.judul), h('p', { class: 'kecil' }, rapi(p.isi)),
          h('p', { class: 'kecil' }, waktuRelatif(Date.parse(p.waktu))));
      })) : null;

    var ka = r.kantong_ayah, bagAyah = null;
    if (ka) {
      var pka = ka.porsi === null ? 0 : ka.porsi;
      bagAyah = h('section', { class: 'bagian' },
        h('h2', null, 'Kantong Ayah'),
        h('div', { class: 'baris', style: 'padding-top:0' },
          h('span', { class: 'nama' }, rpS(ka.terpakai) + ' dari ' + rpS(ka.jatah)),
          h('span', { class: 'jumlah' + (ka.sisa < 0 ? ' merah' : '') }, ka.sisa < 0 ? 'lewat ' + rpS(-ka.sisa) : 'sisa ' + rpS(ka.sisa)),
          h('div', { class: 'bar ' + (pka >= 1 ? 'lewat' : (pka >= 0.85 ? 'akan_lewat' : '')), role: 'img', 'aria-label': 'Kantong Ayah terpakai ' + persen(pka) },
            h('div', { class: 'isi', style: 'width:' + Math.min(pka, 1) * 100 + '%' }),
            h('div', { class: 'waktu', style: 'left:' + Math.min(pw, 1) * 100 + '%' })),
          h('span', { class: 'detail' }, 'Pengeluaran Ayah dari sisa gaji setelah transfer istri & cicilan (mobil ' + rpS(r.cicilan.nominal) + ' + pribadi ' + rpS(ka.cicilan_pribadi) + ').')));
    }

    var cc = r.cicilan, bagCicilan = (cc && cc.tenor) ? h('section', { class: 'bagian' },
      h('h2', null, 'Cicilan mobil'),
      h('div', { class: 'baris', style: 'padding-top:0' },
        h('span', { class: 'nama' }, 'Ke-' + cc.bulan_ke + ' dari ' + cc.tenor + ' bulan (' + persen(cc.porsi) + ')'),
        h('span', { class: 'jumlah' }, 'sisa ' + rpS(cc.sisa_nominal)),
        h('div', { class: 'bar', role: 'img', 'aria-label': 'Progres cicilan ' + persen(cc.porsi) },
          h('div', { class: 'isi', style: 'width:' + Math.min(cc.porsi, 1) * 100 + '%' })),
        h('span', { class: 'detail' }, 'Sudah masuk ' + rpS(cc.total_dibayar) + '. Sisa ' +
          cc.sisa_bulan + ' bulan lagi (lunas ' + cc.lunas + ').'))) : null;

    return h('div', null,
      kepala('Siklus ' + BULAN[Number(r.siklus.kode.slice(5)) - 1], sub, true),
      kartuSambut(), pitaAntre(), pokok, bagPerhatian, bagAyah, bagAmplop, bagCicilan, bagCatatan, bagKabar, infoSegar());
  }

  // ================================================================ layar: pos
  function layarPos() {
    var r = R();
    if (!r) return h('div', null, kepala('Pos belanja', null, true), kerangka());
    var pw = r.status ? r.status.porsi_waktu : 1;
    var transaksi = r.transaksi || [];
    function baris(p) {
      var terbuka = S.posTerbuka === p.nama;
      var rasio = p.jatah > 0 ? p.terpakai / p.jatah : null;
      var detail;
      if (p.status === 'tanpa_jatah') detail = 'Belum punya jatah. Muncul karena ada belanja siklus ini.';
      else if (p.status === 'lewat') detail = 'Lewat ' + rpS(p.terpakai - p.jatah) + '.';
      else if (p.alasan === 'proyeksi') detail = 'Kalau lajunya tetap jadi ' + rpS(p.proyeksi) + '.';
      else if (p.alasan === 'mendekati') detail = 'Sudah ' + persen(rasio) + ', sisa ' + rpS(p.jatah - p.terpakai) + '.';
      else detail = 'Sisa ' + rpS(p.jatah - p.terpakai) + '.';
      var tx = transaksi.filter(function (t) { return t.pos === p.nama; });
      var id = 'isi-' + p.nama.replace(/\W+/g, '-');
      return h('li', null,
        h('button', { class: 'baris', type: 'button', 'aria-expanded': terbuka ? 'true' : 'false', 'aria-controls': id,
          onclick: function () { S.posTerbuka = terbuka ? null : p.nama; render({ data: true }); } },
          h('span', { class: 'nama' }, p.nama),
          h('span', { class: 'jumlah' + (p.status === 'lewat' ? ' merah' : '') }, rpS(p.terpakai),
            h('span', { class: 'redup', style: 'font-weight:500' }, p.jatah ? ' / ' + rpS(p.jatah).replace('Rp ', '') : '')),
          p.jatah ? h('div', { class: 'bar ' + p.status, 'aria-hidden': 'true' },
            h('div', { class: 'isi', style: 'width:' + Math.min(rasio, 1) * 100 + '%' }),
            r.siklus.berjalan ? h('div', { class: 'waktu', style: 'left:' + Math.min(pw, 1) * 100 + '%' }) : null) : null,
          h('span', { class: 'detail' }, detail)),
        terbuka ? h('div', { class: 'isi-pos', id: id },
        tx.length ? tx.slice(0, 40).map(function (t) {
            return h('div', { class: 'tx' }, h('span', null, (t.ket || t.kat) + (t.ket ? ', ' + t.kat : '') + (t.siapa && t.siapa !== 'Lainnya' ? ' (' + t.siapa + ')' : '')),
              h('span', { class: 'angka' }, rpS(t.nominal)));
          }) : h('p', { class: 'kecil' }, 'Belum ada transaksi tercatat untuk pos ini.')) : null);
    }
    var grup = PILAR.map(function (pl) {
      var daftar = r.pos.filter(function (p) { return p.pilar === pl; });
      if (!daftar.length) return null;
      return h('section', { class: 'bagian' }, h('h2', null, pl), h('ul', { class: 'buku' }, daftar.map(baris)));
    });
    var luar = h('section', { class: 'bagian' }, h('h2', null, 'Di luar jatah belanja'),
      h('ul', { class: 'buku' },
        h('li', null, h('div', { class: 'baris' }, h('span', { class: 'nama' }, 'Cicilan & Utang'),
          h('span', { class: 'jumlah' }, rpS(r.cicilan.dibayar)),
          h('span', { class: 'detail' }, 'Tetap ' + rpS(r.cicilan.nominal) + ' per siklus. Diisi otomatis kalau belum dicatat.'))),
        h('li', null, h('div', { class: 'baris' }, h('span', { class: 'nama' }, 'Pemasukan'),
          h('span', { class: 'jumlah hijau' }, rpS(r.pemasukan.total)),
          h('span', { class: 'detail' }, r.pemasukan.gaji_otomatis ? 'Termasuk gaji bawaan ' + rpS(r.parameter.gaji) + ' karena gaji siklus ini belum dicatat.' :
            (r.pemasukan.total ? 'Sesuai catatan pemasukan.' : 'Belum ada pemasukan tercatat untuk siklus ini.'))))));
    return h('div', null,
      kepala('Pos belanja', 'Siklus ' + namaSiklus(r.siklus.kode) + (r.status ? ', hari ke-' + r.status.hari_ke + ' dari ' + r.status.hari_total : ''), true),
      h('p', { class: 'kecil' }, 'Garis tegak di tiap bar adalah posisi hari ini. Bar yang melewatinya berarti posnya terpakai lebih cepat dari waktu.'),
      grup, luar, infoSegar());
  }

  // ================================================================ layar: catat
  function siklusBawaan() {
    var r = R();
    if (r && r.siklus.kini) return r.siklus.kini;
    var cutoff = (r && r.parameter.tanggal_gajian) || 25, d = new Date();
    var p = d.getFullYear() * 12 + d.getMonth() - (d.getDate() >= Math.min(cutoff, 28) ? 0 : 1);
    return Math.floor(p / 12) + '-' + String(p % 12 + 1).padStart(2, '0');
  }
  function catatBaru(lama) {
    return {
      tipe: lama ? lama.tipe : 'Pengeluaran', nominal: '', ket: '', kategori: '', siapa: lama ? lama.siapa : '',
      prioritas: '', jenis_masuk: 'Gaji', siklus: lama && lama.manual && lama.manual.siklus ? lama.siklus : siklusBawaan(),
      manual: { siapa: !!(lama && lama.manual && lama.manual.siapa), siklus: !!(lama && lama.manual && lama.manual.siklus) },
      dicoba: false
    };
  }
  var drafTimer = null;
  function simpanDraf() { clearTimeout(drafTimer); drafTimer = setTimeout(function () { simpan.tulis('draf', S.catat); }, 250); }

  function skema() { return (S.data && S.data.skema) || {}; }
  function pilihanDari(info, cadangan) { return info && info.pilihan && info.pilihan.length ? info.pilihan : cadangan; }
  function pilihanKategori() { return pilihanDari(skema().kategori, S.model ? S.model.label.kat : []); }
  function pilihanSiapa() { return pilihanDari(skema().siapa, ['Rumah', 'Ayah', 'Mama', 'Afraz']); }
  function pilihanPrio() {
    return pilihanDari(skema().prioritas, ['Pokok', 'Hepi-Hepi']).filter(function (x) { return !/pemasukan/i.test(x); });
  }

  function grupChip(nama, label, daftar, nilai, saat, opsi) {
    opsi = opsi || {};
    return h('div', { class: 'chip-grup', role: 'radiogroup', 'aria-label': label, id: 'grup-' + nama },
      daftar.map(function (x) {
        var nm = typeof x === 'string' ? x : x.nama;
        var dipilih = nm === nilai;
        return h('button', { class: 'chip' + (x.usulan ? ' usulan' : ''), type: 'button', role: 'radio',
          'aria-checked': dipilih ? 'true' : 'false', onclick: function () { saat(nm); } },
          h('span', { class: 'terpangkas' }, nm), x.p !== undefined && opsi.tampilP ? h('span', { class: 'p' }, Math.round(x.p * 100) + '%') : null);
      }));
  }

  function layarCatat() {
    if (S.hasilCatat) return layarHasilCatat();
    if (!S.catat) S.catat = simpan.baca('draf', null) || catatBaru();
    var c = S.catat;
    c.manual = c.manual || {};
    if (!c.manual.siklus) c.siklus = siklusBawaan();
    var sk = skema();
    var formGalat = sk.galat ? h('div', { class: 'pita peringatan', role: 'alert' },
      h('span', null, h('strong', null, 'Google Form tidak terbaca. '), sk.galat)) : null;

    var seg = h('div', { class: 'segmen', role: 'radiogroup', 'aria-label': 'Jenis catatan' },
      ['Pengeluaran', 'Pemasukan'].map(function (t) {
        return h('button', { type: 'button', role: 'radio', 'aria-checked': c.tipe === t ? 'true' : 'false',
          onclick: function () { if (c.tipe !== t) { c.tipe = t; c.kategori = ''; c.manual.kategori = false; simpanDraf(); render(); } } }, t);
      }));

    var inNominal = h('input', { id: 'in-nominal', type: 'text', inputmode: 'numeric', enterkeyhint: 'next', autocomplete: 'off',
      placeholder: '0', value: formatNominal(c.nominal), 'aria-describedby': 'galat-nominal',
      oninput: function (e) {
        var el = e.target, n = formatNominal(el.value);
        el.value = n; c.nominal = n; simpanDraf();
        if (c.dicoba) periksaForm();
      },
      onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('in-ket').focus(); } } });
    var nominal = h('div', { class: 'isian' },
      h('label', { for: 'in-nominal' }, 'Nominal'),
      h('div', { class: 'nominal' }, h('span', { 'aria-hidden': 'true' }, 'Rp'), inNominal),
      h('p', { class: 'galat', id: 'galat-nominal' }));

    var saranTimer = null;
    var inKet = h('input', { id: 'in-ket', class: 'masukan', type: 'text', enterkeyhint: 'done', autocomplete: 'off',
      autocapitalize: 'sentences', value: c.ket, placeholder: c.tipe === 'Pengeluaran' ? 'mis. nasi padang, es teh' : 'mis. Gaji November',
      'aria-describedby': 'bantu-ket',
      oninput: function (e) {
        c.ket = e.target.value; simpanDraf();
        clearTimeout(saranTimer); saranTimer = setTimeout(perbaruiSaran, 120);
      },
      onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } } });
    var ket = h('div', { class: 'isian' },
      h('label', { for: 'in-ket' }, 'Keterangan'),
      inKet,
      h('div', { class: 'chip-grup', id: 'wadah-usulan', 'aria-label': 'Usulan keterangan' }),
      h('p', { class: 'bantu', id: 'bantu-ket' }, c.tipe === 'Pengeluaran' ?
        'Pisahkan dengan koma kalau beberapa barang. Jenis, siapa, dan kebutuhan ditebak dari keterangan.' : 'Boleh dikosongkan.'));

    var bagianTipe;
    if (c.tipe === 'Pengeluaran') {
      bagianTipe = [
        h('div', { class: 'isian' }, h('span', { class: 'label', id: 'lbl-kat' }, 'Jenis pengeluaran'),
          h('div', { id: 'wadah-kat' }), h('p', { class: 'galat', id: 'galat-kat' })),
        h('div', { class: 'isian' }, h('span', { class: 'label' }, 'Untuk siapa'), h('div', { id: 'wadah-siapa' }),
          h('p', { class: 'galat', id: 'galat-siapa' })),
        h('div', { class: 'isian' }, h('span', { class: 'label' }, 'Kebutuhan'), h('div', { id: 'wadah-prio' }))
      ];
    } else {
      var jenis = pilihanDari(sk.jenis_masuk, JENIS_MASUK);
      var inJenis = h('input', { id: 'in-jenis', class: 'masukan', type: 'text', value: c.jenis_masuk, autocapitalize: 'words',
        oninput: function (e) { c.jenis_masuk = e.target.value; simpanDraf(); perbaruiChipJenis(); } });
      bagianTipe = [
        h('div', { class: 'isian' }, h('label', { for: 'in-jenis' }, 'Jenis pemasukan'),
          sk.jenis_masuk && sk.jenis_masuk.pilihan ? null : inJenis,
          h('div', { id: 'wadah-jenis' }, grupChip('jenis', 'Jenis pemasukan', jenis, c.jenis_masuk, function (v) {
            c.jenis_masuk = v; inJenis.value = v; simpanDraf(); perbaruiChipJenis();
          }))),
        h('div', { class: 'isian' }, h('span', { class: 'label' }, 'Untuk siapa'), h('div', { id: 'wadah-siapa' }))
      ];
      if (!c.siapa) c.siapa = 'Ayah';
    }

    var kini = siklusBawaan(), lalu = siklusGeser(kini, -1);
    var opsiSiklus = [kini, lalu];
    if (opsiSiklus.indexOf(c.siklus) < 0) opsiSiklus.push(c.siklus);
    var pilihSiklusLain = h('select', { class: 'masukan', 'aria-label': 'Siklus lain', style: 'margin-top:4px',
      onchange: function (e) { if (e.target.value) { c.siklus = e.target.value; c.manual.siklus = true; simpanDraf(); render(); } } },
      h('option', { value: '' }, 'Siklus lebih lama…'),
      [2, 3, 4, 5, 6].map(function (n) { var k = siklusGeser(kini, -n); return h('option', { value: k }, namaSiklus(k)); }));
    var siklus = h('div', { class: 'isian' },
      h('span', { class: 'label' }, 'Siklus gajian'),
      h('div', { class: 'chip-grup', role: 'radiogroup', 'aria-label': 'Siklus gajian' }, opsiSiklus.map(function (k) {
        return h('button', { class: 'chip', type: 'button', role: 'radio', 'aria-checked': c.siklus === k ? 'true' : 'false',
          onclick: function () { c.siklus = k; c.manual.siklus = k !== kini; simpanDraf(); render(); } }, namaSiklus(k) + (k === kini ? ' (berjalan)' : ''));
      })),
      h('p', { class: 'bantu' }, 'Belanja dicatat ke siklus gaji yang membiayainya: gajian tanggal 25 membiayai sampai tanggal 24 bulan berikutnya.'),
      pilihSiklusLain);

    var tombol = h('button', { class: 'tombol utama penuh', type: 'submit', id: 'tombol-catat' },
      c.tipe === 'Pengeluaran' ? 'Catat pengeluaran' : 'Catat pemasukan');
    var form = h('form', { id: 'form-catat', novalidate: true, onsubmit: function (e) { e.preventDefault(); kirimCatat(); } },
      kepala('Catat', 'Masuk ke Google Form yang sama', false),
      formGalat, seg, nominal, ket, bagianTipe, siklus,
      h('div', { class: 'kirim' }, tombol, h('p', { class: 'kecil', id: 'info-antre' })));
    setTimeout(function () { perbaruiSaran(); perbaruiInfoAntre(); if (c.dicoba) periksaForm(); }, 0);
    return form;
  }

  function perbaruiChipJenis() {
    var w = document.getElementById('wadah-jenis'), c = S.catat;
    if (!w) return;
    w.textContent = '';
    w.appendChild(grupChip('jenis', 'Jenis pemasukan', pilihanDari(skema().jenis_masuk, JENIS_MASUK), c.jenis_masuk, function (v) {
      c.jenis_masuk = v; var i = document.getElementById('in-jenis'); if (i) i.value = v; simpanDraf(); perbaruiChipJenis();
    }));
  }

  /** Perbarui usulan, tebakan jenis/siapa/kebutuhan tanpa membangun ulang form. */
  function perbaruiSaran() {
    var c = S.catat;
    if (!c || !document.getElementById('form-catat')) return;
    var m = S.model;
    var usulan = document.getElementById('wadah-usulan');
    if (usulan) {
      usulan.textContent = '';
      if (m && c.tipe === 'Pengeluaran') {
        Saran.lengkapi(m, c.ket, 4).forEach(function (u) {
          usulan.appendChild(h('button', { class: 'chip usulan', type: 'button',
            'aria-label': 'Pakai ' + u.teks + (u.nominal ? ', biasanya ' + rpS(u.nominal) : ''),
            onclick: function () {
              c.ket = Saran.pasangFrasa(c.ket, u.teks);
              var i = document.getElementById('in-ket'); if (i) i.value = c.ket;
              if (!angkaDari(c.nominal) && u.nominal) {
                c.nominal = formatNominal(String(Math.round(u.nominal)));
                var n = document.getElementById('in-nominal'); if (n) n.value = c.nominal;
              }
              simpanDraf(); perbaruiSaran();
            } }, h('span', { class: 'terpangkas' }, u.teks), u.nominal ? h('span', { class: 'nominal' }, rpS(u.nominal)) : null));
        });
      }
    }
    var boleh = { kat: pilihanKategori(), siapa: pilihanSiapa(), prio: pilihanPrio() };
    var t = m && c.ket.trim() ? Saran.tebak(m, c.ket, { boleh: boleh, kategori: c.manual.kategori ? c.kategori : null }) :
      { dikenal: 0, kat: [], siapa: [], prio: [] };
    var ada = t.dikenal > 0;
    if (c.tipe === 'Pengeluaran') {
      if (!c.manual.kategori) c.kategori = ada && t.kat[0] && t.kat[0].p >= Saran.AMBANG_PILIH ? t.kat[0].nama : (c.manual.kategori ? c.kategori : '');
      if (!c.manual.siapa) c.siapa = ada && t.siapa[0] ? t.siapa[0].nama : (c.siapa || '');
      if (!c.manual.prioritas) c.prioritas = ada && t.prio[0] ? t.prio[0].nama : (c.prioritas || pilihanPrio()[0] || '');
      gambarKategori(t, ada);
      gambarSederhana('siapa', 'Untuk siapa', pilihanSiapa(), c.siapa, ada ? t.siapa : []);
      gambarSederhana('prio', 'Kebutuhan', pilihanPrio(), c.prioritas, ada ? t.prio : []);
    } else {
      gambarSederhana('siapa', 'Untuk siapa', pilihanSiapa(), c.siapa, []);
    }
    simpanDraf();
  }

  function gambarKategori(t, ada) {
    var w = document.getElementById('wadah-kat'), c = S.catat;
    if (!w) return;
    w.textContent = '';
    var semua = pilihanKategori();
    var tampil = [];
    function tambah(nama, p, usulan) {
      if (!nama || tampil.some(function (x) { return x.nama === nama; }) || semua.indexOf(nama) < 0) return;
      tampil.push({ nama: nama, p: p, usulan: usulan });
    }
    if (c.kategori) tambah(c.kategori, undefined, false);
    if (ada) t.kat.slice(0, 3).forEach(function (x) { if (x.p >= 0.05) tambah(x.nama, x.p, !c.manual.kategori); });
    if (tampil.length < 4 && S.model) {
      // tanpa petunjuk: jenis yang paling sering dipakai
      var prior = S.model.prior.kat;
      S.model.label.kat.map(function (n, i) { return [n, prior[i] || 0]; }).sort(function (a, b) { return b[1] - a[1]; })
        .forEach(function (x) { if (tampil.length < 6) tambah(x[0]); });
    }
    if (!tampil.length) semua.slice(0, 6).forEach(function (n) { tambah(n); });
    w.appendChild(grupChip('kat', 'Jenis pengeluaran', tampil, c.kategori, function (v) {
      c.kategori = v; c.manual.kategori = true; simpanDraf(); perbaruiSaran(); if (c.dicoba) periksaForm();
    }, { tampilP: ada }));
    var pilih = h('select', { class: 'masukan', 'aria-label': 'Semua jenis pengeluaran', style: 'margin-top:8px',
      onchange: function (e) { if (e.target.value) { c.kategori = e.target.value; c.manual.kategori = true; simpanDraf(); perbaruiSaran(); if (c.dicoba) periksaForm(); } } },
      h('option', { value: '' }, 'Semua jenis…'),
      semua.map(function (n) { return h('option', { value: n, selected: n === c.kategori }, n); }));
    w.appendChild(pilih);
    if (ada && !c.manual.kategori) {
      w.appendChild(h('p', { class: 'bantu', style: 'margin-top:6px' }, c.kategori ?
        'Ditebak dari keterangan. Ketuk jenis lain kalau keliru.' : 'Belum yakin dengan tebakannya, pilih salah satu.'));
    }
  }

  function gambarSederhana(nama, label, daftar, nilai, tebakan) {
    var w = document.getElementById('wadah-' + nama), c = S.catat;
    if (!w) return;
    w.textContent = '';
    var kunci = nama === 'prio' ? 'prioritas' : nama;
    var top = tebakan[0] && !c.manual[kunci] ? tebakan[0].nama : null;
    w.appendChild(grupChip(nama, label, daftar.map(function (x) { return { nama: x, usulan: x === top }; }), nilai, function (v) {
      c[kunci] = v; c.manual[kunci] = true; simpanDraf(); perbaruiSaran(); if (c.dicoba) periksaForm();
    }));
  }

  function perbaruiInfoAntre() {
    var el = document.getElementById('info-antre');
    if (!el) return;
    el.textContent = S.antre.length ? S.antre.length + ' catatan menunggu dikirim.' : '';
  }

  function periksaForm() {
    var c = S.catat, ok = true;
    function tulis(id, pesan) { var el = document.getElementById(id); if (el) el.textContent = pesan || ''; if (pesan) ok = false; }
    var n = angkaDari(c.nominal);
    tulis('galat-nominal', n > 0 ? '' : 'Isi nominalnya dulu.');
    var inN = document.getElementById('in-nominal'); if (inN) inN.setAttribute('aria-invalid', n > 0 ? 'false' : 'true');
    if (c.tipe === 'Pengeluaran') {
      tulis('galat-kat', c.kategori ? '' : 'Pilih jenis pengeluarannya.');
      tulis('galat-siapa', c.siapa ? '' : 'Pilih untuk siapa belanja ini.');
    }
    return ok;
  }

  function kirimCatat() {
    var c = S.catat;
    c.dicoba = true;
    if (!c.manual.siklus) c.siklus = siklusBawaan();
    if (!periksaForm()) {
      var galat = document.querySelector('#form-catat .galat:not(:empty)');
      if (galat) galat.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    var a = c.siklus.split('-').map(Number);
    var isian = { tipe: c.tipe, nominal: angkaDari(c.nominal), ket: c.ket.trim(), bulan: a[1], tahun: a[0], siapa: c.siapa };
    if (c.tipe === 'Pengeluaran') { isian.kategori = c.kategori; isian.prioritas = c.prioritas; }
    else isian.jenis_masuk = (c.jenis_masuk || '').trim() || 'Gaji';
    var item = { id: uuid(), dibuat: Date.now(), isian: isian };
    S.antre.push(item);
    simpanAntre();
    S.catat = catatBaru(c);
    simpan.tulis('draf', S.catat);
    S.hasilCatat = { id: item.id, keadaan: 'mengirim', item: item };
    render();
    kirimAntre();
  }

  function layarHasilCatat() {
    var hc = S.hasilCatat, x = hc.item.isian, judul, isi, kelas = '';
    if (hc.keadaan === 'mengirim') { judul = 'Mengirim…'; isi = ringkasIsian(x) + ' sedang dikirim ke Google Form.'; }
    else if (hc.keadaan === 'terkirim') {
      judul = 'Tercatat';
      isi = (hc.hasil && hc.hasil.dampak && hc.hasil.dampak.kalimat) || ringkasIsian(x) + ' tercatat.';
      if (hc.hasil && hc.hasil.duplikat) isi = 'Catatan ini sudah masuk sebelumnya, jadi tidak dicatat dua kali.';
    } else if (hc.keadaan === 'tertunda') {
      judul = 'Tersimpan di HP';
      isi = ringkasIsian(x) + ' belum terkirim (' + hc.galat.replace(/\.$/, '') + '). Dikirim otomatis saat ada sinyal atau saat aplikasi dibuka lagi.';
    } else {
      judul = 'Ditolak'; kelas = ' merah';
      isi = hc.galat;
    }
    var dampak = hc.hasil && hc.hasil.dampak;
    var bar = null;
    if (dampak && dampak.jatah) {
      var rasio = dampak.terpakai / dampak.jatah;
      bar = h('div', { class: 'bar ' + (rasio >= 1 ? 'lewat' : (rasio >= 0.85 ? 'akan_lewat' : '')), style: 'margin-top:14px', 'aria-hidden': 'true' },
        h('div', { class: 'isi', style: 'width:' + Math.min(rasio, 1) * 100 + '%' }));
    }
    return h('div', null,
      kepala('Catat', null, false),
      h('section', { class: 'hasil', 'aria-live': 'polite' },
        h('h2', { class: kelas.trim() }, judul),
        h('p', null, rapi(isi)), bar,
        dampak && !dampak.berjalan ? h('p', { class: 'kecil' }, 'Masuk ke siklus ' + dampak.siklus_nama + '.') : null),
      h('div', { class: 'kirim' },
        hc.keadaan === 'ditolak' ?
          h('button', { class: 'tombol utama penuh', type: 'button', onclick: function () { ubahGagal(hc.item); } }, 'Perbaiki catatan') :
          h('button', { class: 'tombol utama penuh', type: 'button', disabled: hc.keadaan === 'mengirim',
            onclick: function () { S.hasilCatat = null; render(); setTimeout(function () { var n = document.getElementById('in-nominal'); if (n) n.focus(); }, 50); } }, 'Catat lagi'),
        h('a', { class: 'tombol penuh', href: '#ringkas' }, 'Lihat ringkasan')));
  }

  function ubahGagal(item) {
    S.gagal = S.gagal.filter(function (x) { return x.id !== item.id; });
    simpanAntre();
    var x = item.isian;
    S.catat = {
      tipe: x.tipe, nominal: formatNominal(String(x.nominal)), ket: x.ket || '', kategori: x.kategori || '', siapa: x.siapa || '',
      prioritas: x.prioritas || '', jenis_masuk: x.jenis_masuk || 'Gaji', siklus: x.tahun + '-' + String(x.bulan).padStart(2, '0'),
      manual: { kategori: !!x.kategori, siapa: !!x.siapa, prioritas: !!x.prioritas, siklus: true }, dicoba: true
    };
    simpan.tulis('draf', S.catat);
    S.hasilCatat = null;
    if (location.hash !== '#catat') location.hash = '#catat'; else render();
    if (item.galat) setTimeout(function () { kabar(item.galat); }, 100);
  }

  // ================================================================ layar: riwayat
  function layarRiwayat() {
    var r = R();
    if (!r) return h('div', null, kepala('Riwayat', null, true), kerangka());
    var kini = r.siklus.kini || r.siklus.kode;
    var kode = S.riwayat.siklus || kini;
    var data = kode === r.siklus.kode ? r : S.riwayat.data[kode];
    var cari = h('input', { class: 'masukan', type: 'search', placeholder: 'Cari keterangan atau jenis', value: S.riwayat.cari,
      'aria-label': 'Cari transaksi', enterkeyhint: 'search',
      oninput: function (e) { S.riwayat.cari = e.target.value; gambarDaftar(); } });
    var wadah = h('div', { id: 'daftar-riwayat' });

    function geser(n) {
      S.riwayat.siklus = siklusGeser(kode, n);
      if (S.riwayat.siklus !== r.siklus.kode && !S.riwayat.data[S.riwayat.siklus]) {
        var k = S.riwayat.siklus;
        panggil('ringkasan', { siklus: k }, { metode: 'GET', batas: 45000 }).then(function (d) {
          S.riwayat.data[k] = d; if (tabKini() === 'riwayat') render({ data: true });
        }, function (e) { kabar(e.message); });
      }
      render({ data: true });
    }
    var ganti = h('div', { class: 'ganti-siklus' },
      h('button', { class: 'tombol-bulat', type: 'button', 'aria-label': 'Siklus sebelumnya', onclick: function () { geser(-1); } }, ikon('kiri')),
      h('div', { class: 'tengah' }, h('h2', null, namaSiklus(kode)),
        data ? h('p', { class: 'kecil' }, tglPendek(data.siklus.awal) + ' – ' + tglPendek(data.siklus.akhir)) : null),
      h('button', { class: 'tombol-bulat', type: 'button', 'aria-label': 'Siklus berikutnya', disabled: kode >= kini, onclick: function () { geser(1); } }, ikon('kanan')));

    function gambarDaftar() {
      wadah.textContent = '';
      var q = S.riwayat.cari.trim().toLowerCase();
      function cocok(t) { return !q || [t.ket, t.kat, t.pos, t.jenis_masuk, t.siapa].join(' ').toLowerCase().indexOf(q) >= 0; }
      // catatan yang belum terkirim / ditolak
      var lokal = S.gagal.map(function (x) { return [x, 'ditolak']; }).concat(S.antre.map(function (x) { return [x, 'menunggu']; }))
        .filter(function (p) { var x = p[0].isian; return (x.tahun + '-' + String(x.bulan).padStart(2, '0')) === kode; });
      if (lokal.length) {
        wadah.appendChild(h('p', { class: 'kelompok-hari' }, 'Di HP ini'));
        wadah.appendChild(h('ul', { class: 'buku' }, lokal.map(function (p) {
          var x = p[0].isian, item = p[0];
          return h('li', null, h('div', { class: 'baris' },
            h('span', { class: 'nama' }, x.ket || x.kategori || x.jenis_masuk, h('span', { class: 'menunggu' }, p[1] === 'ditolak' ? 'ditolak' : 'menunggu')),
            h('span', { class: 'jumlah' + (x.tipe === 'Pemasukan' ? ' hijau' : '') }, (x.tipe === 'Pemasukan' ? '+' : '') + rpS(x.nominal)),
            h('span', { class: 'detail' }, p[1] === 'ditolak' ? item.galat : (x.kategori || x.jenis_masuk) + ', untuk ' + x.siapa),
            p[1] === 'ditolak' ? h('span', { class: 'detail chip-grup', style: 'margin-top:6px' },
              h('button', { class: 'tombol kecil', type: 'button', onclick: function () { ubahGagal(item); } }, 'Perbaiki'),
              h('button', { class: 'tombol kecil bahaya', type: 'button', onclick: function () {
                S.gagal = S.gagal.filter(function (z) { return z.id !== item.id; }); simpanAntre(); render({ data: true });
              } }, 'Hapus catatan')) : null));
        })));
      }
      if (!data) { wadah.appendChild(kerangka()); return; }
      var tx = (data.transaksi || []).filter(cocok);
      if (!tx.length) {
        wadah.appendChild(h('div', { class: 'kosong' }, h('h2', null, q ? 'Tidak ada yang cocok' : 'Belum ada catatan'),
          h('p', { class: 'teks' }, q ? 'Coba kata lain, misalnya nama warung atau jenisnya.' : 'Catatan siklus ini akan muncul di sini.'),
          q ? null : h('div', { class: 'kirim' }, h('a', { class: 'tombol', href: '#catat' }, 'Catat pengeluaran'))));
        return;
      }
      var kelompok = {}, urutan = [];
      tx.forEach(function (t) {
        var k = t.waktu ? t.waktu.slice(0, 10) : 'lain';
        if (!kelompok[k]) { kelompok[k] = []; urutan.push(k); }
        kelompok[k].push(t);
      });
      urutan.forEach(function (k) {
        var label = 'Tanpa tanggal';
        if (k !== 'lain') { var a = k.split('-').map(Number), d = new Date(a[0], a[1] - 1, a[2]); label = HARI[d.getDay()] + ', ' + a[2] + ' ' + BULAN3[a[1] - 1]; }
        var total = kelompok[k].reduce(function (s, t) { return s + (t.tipe === 'Pengeluaran' ? t.nominal : 0); }, 0);
        wadah.appendChild(h('p', { class: 'kelompok-hari' }, label + (total ? ', keluar ' + rpS(total) : '')));
        wadah.appendChild(h('ul', { class: 'buku' }, kelompok[k].map(function (t) {
          var masuk = t.tipe === 'Pemasukan';
          return h('li', null, h('div', { class: 'baris' },
            h('span', { class: 'nama' }, t.ket || t.kat || t.jenis_masuk || t.tipe),
            h('span', { class: 'jumlah' + (masuk ? ' hijau' : '') }, (masuk ? '+' : '') + rpS(t.nominal)),
            h('span', { class: 'detail' }, masuk ? (t.jenis_masuk || 'Pemasukan') : t.kat + (t.siapa && t.siapa !== 'Lainnya' ? ', untuk ' + t.siapa : '') +
              (t.tipe === 'Transfer' ? ', jatah amplop' : ''))));
        })));
      });
      if ((data.transaksi || []).length >= 300) wadah.appendChild(h('p', { class: 'kecil', style: 'margin-top:12px' }, 'Menampilkan 300 catatan terbaru siklus ini.'));
    }
    gambarDaftar();
    var ringkas = data ? h('p', { class: 'kecil', style: 'margin:-4px 0 12px;text-align:center' },
      'Belanja ' + rpS(data.belanja.terpakai) + ' dari jatah ' + rpS(data.belanja.jatah) + (data.belum_lengkap ? '. Catatannya tampak belum lengkap.' : '.')) : null;
    return h('div', null, kepala('Riwayat', null, true), ganti, ringkas, cari, wadah);
  }

  // ================================================================ notifikasi
  function dukunganPush() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function keUint8(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function samaKunci(a, b) {
    if (!a || !b) return false;
    a = new Uint8Array(a);
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function langgananPush() {
    if (!dukunganPush()) return Promise.resolve(null);
    return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).catch(function () { return null; });
  }
  /** Tentukan keadaan notifikasi dan sinkronkan langganan dengan server bila perlu. */
  function periksaNotif() {
    if (iOS() && !modeAplikasi()) { S.notif.status = 'perlu-layar-utama'; return Promise.resolve(); }
    if (!dukunganPush()) { S.notif.status = 'tak-didukung'; return Promise.resolve(); }
    if (Notification.permission === 'denied') { S.notif.status = 'ditolak'; return Promise.resolve(); }
    return langgananPush().then(function (sub) {
      S.notif.sub = sub;
      var diServer = S.data && S.data.langganan;
      var lama = S.notif.status;
      if (sub && diServer) S.notif.status = 'aktif';
      else if (sub && S.data) {
        // HP punya langganan tapi server tidak (mis. dihapus karena kedaluwarsa): kirim ulang.
        S.notif.status = 'aktif';
        kirimLangganan(sub).catch(function () { S.notif.status = 'sinkron-gagal'; render({ data: true }); });
      } else if (!sub && diServer && Notification.permission === 'granted') S.notif.status = 'sinkron-gagal';
      else S.notif.status = 'belum';
      if (lama !== S.notif.status) render({ data: true });
    });
  }
  function kirimLangganan(sub) {
    var j = sub.toJSON();
    return panggil('langganan', { perangkat: S.perangkat.id, nama: S.perangkat.nama || 'iPhone',
      langganan: { endpoint: j.endpoint, keys: j.keys } }).then(function (d) {
      if (S.data) { S.data.langganan = { nama: S.perangkat.nama, pref: d.pref, mode: 'isi', ok: '', galat: '' }; simpan.tulis('data', S.data); }
      return d;
    });
  }
  function aktifkanNotif(tombol) {
    if (!S.data || !S.data.vapid) { kabar('Kunci notifikasi belum ada di server. Jalankan pasang() di Apps Script.'); return; }
    if (tombol) { tombol.disabled = true; tombol.classList.add('memuat'); }
    // requestPermission harus dipanggil langsung dari ketukan (aturan iOS).
    Notification.requestPermission().then(function (izin) {
      if (izin !== 'granted') throw new Error(izin === 'denied' ?
        'Izin notifikasi ditolak. Buka Pengaturan iPhone, Notifikasi, Kas Rumah, lalu izinkan.' : 'Izin notifikasi belum diberikan.');
      return navigator.serviceWorker.ready;
    }).then(function (reg) {
      var kunci = keUint8(S.data.vapid);
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub && !samaKunci(sub.options && sub.options.applicationServerKey, kunci)) return sub.unsubscribe().then(function () { return null; });
        return sub;
      }).then(function (sub) {
        return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: kunci });
      });
    }).then(function (sub) { S.notif.sub = sub; return kirimLangganan(sub); })
      .then(function () { S.notif.status = 'aktif'; kabar('Notifikasi aktif. Coba kirim notifikasi uji dari Atur.'); perbaruiLencana(); },
        function (e) { kabar(e.message || 'Notifikasi gagal diaktifkan.'); periksaNotif(); })
      .then(function () { render({ data: true }); });
  }
  function matikanNotif(tombol) {
    tombol.disabled = true;
    langgananPush().then(function (sub) { return sub ? sub.unsubscribe() : null; })
      .then(function () { return panggil('berhenti', { perangkat: S.perangkat.id }); })
      .then(function () { if (S.data) { S.data.langganan = null; simpan.tulis('data', S.data); } S.notif.status = 'belum'; kabar('Notifikasi dimatikan di HP ini.'); },
        function (e) { kabar(e.message); })
      .then(function () { render({ data: true }); });
  }
  function ujiNotif(tombol) {
    tombol.disabled = true; tombol.classList.add('memuat');
    panggil('uji_notif', { perangkat: S.perangkat.id }).then(function (d) {
      kabar(d.terkirim ? 'Notifikasi uji dikirim. Biasanya muncul dalam beberapa detik.' :
        'Gagal dikirim: ' + (d.galat || 'tanpa keterangan') + '. Coba matikan lalu aktifkan lagi notifikasinya.');
    }, function (e) { kabar(e.message); }).then(function () { tombol.disabled = false; tombol.classList.remove('memuat'); });
  }

  // ================================================================ layar: atur
  function layarAtur() {
    var d = S.data || {}, r = R(), l = d.langganan;
    var inNama = h('input', { class: 'masukan', id: 'in-nama', value: S.perangkat.nama, autocapitalize: 'words', placeholder: 'mis. Mama',
      onchange: function (e) {
        S.perangkat.nama = e.target.value.trim().slice(0, 30); simpan.tulis('perangkat', S.perangkat);
        if (l) panggil('pref', { perangkat: S.perangkat.id, nama: S.perangkat.nama }).then(function () { kabar('Nama disimpan.'); }, function (er) { kabar(er.message); });
        else kabar('Nama disimpan.');
      } });
    var hp = h('section', { class: 'bagian', style: 'padding-top:0' }, h('h2', null, 'HP ini'),
      h('div', { class: 'isian', style: 'margin-top:8px' }, h('label', { for: 'in-nama' }, 'Nama pemakai'), inNama,
        h('p', { class: 'bantu' }, 'Muncul di notifikasi anggota lain, misalnya "Mama mencatat Makan Rp 50 rb".')));

    var st = S.notif.status, isiNotif;
    if (st === 'perlu-layar-utama') isiNotif = h('p', { class: 'teks' }, 'Di iPhone, notifikasi hanya bisa diaktifkan dari Kas Rumah yang dibuka lewat ikon di Layar Utama. Tambahkan dulu lewat tombol Bagikan di Safari.');
    else if (st === 'tak-didukung') isiNotif = h('p', { class: 'teks' }, 'Browser ini belum mendukung notifikasi web. Di iPhone butuh iOS 16.4 atau lebih baru.');
    else if (st === 'ditolak') isiNotif = h('p', { class: 'teks' }, 'Izin notifikasi ditolak. Buka Pengaturan iPhone, Notifikasi, Kas Rumah, lalu izinkan. Setelah itu kembali ke sini.');
    else if (st === 'aktif' && l) {
      var PREF = [['lewat', 'Pos lewat jatah', 'Sekali per pos tiap siklus.'],
        ['status', 'Laju belanja', 'Saat status naik jadi "Mulai cepat" atau "Perlu direm".'],
        ['amplop', 'Amplop istri', 'Saat terpakai 85% dan saat terlewati.'],
        ['mingguan', 'Ringkasan mingguan', 'Minggu malam.'],
        ['tutup', 'Siklus tutup', 'Tanggal 25 pagi, ringkasan siklus yang baru selesai.'],
        ['anggota', 'Saat anggota lain mencatat', 'Kabar tiap ada catatan dari HP lain.']];
      isiNotif = [
        h('p', { class: 'kecil' }, 'Aktif. Tidak ada notifikasi pukul 22.00–07.00; yang tertunda dikirim pagi.' +
          (l.galat ? ' Galat terakhir: ' + l.galat : '') + (l.mode === 'tanpa_isi' ? ' Mode ambil sendiri.' : '')),
        h('div', null, PREF.map(function (p) {
          var id = 'pref-' + p[0];
          return h('label', { class: 'sakelar', for: id },
            h('span', null, h('span', { style: 'font-weight:650' }, p[1]), h('p', { class: 'kecil' }, p[2])),
            h('input', { type: 'checkbox', id: id, role: 'switch', checked: l.pref ? l.pref[p[0]] !== false : true,
              onchange: function (e) {
                var pref = {}; pref[p[0]] = e.target.checked;
                panggil('pref', { perangkat: S.perangkat.id, pref: pref }).then(function (hasil) {
                  if (S.data.langganan) S.data.langganan.pref = hasil.pref; simpan.tulis('data', S.data);
                }, function (er) { e.target.checked = !e.target.checked; kabar(er.message); });
              } }));
        })),
        h('div', { class: 'chip-grup', style: 'margin-top:12px' },
          h('button', { class: 'tombol kecil utama', type: 'button', onclick: function (e) { ujiNotif(e.currentTarget); } }, 'Kirim notifikasi uji'),
          h('button', { class: 'tombol kecil', type: 'button', onclick: function (e) { matikanNotif(e.currentTarget); } }, 'Matikan notifikasi'))
      ];
    } else {
      isiNotif = [
        h('p', { class: 'teks' }, st === 'sinkron-gagal' ? 'Langganan notifikasi di HP ini terputus. Aktifkan ulang.' :
          'Kabar saat ada pos yang lewat jatah, laju belanja mulai cepat, amplop istri hampir habis, ringkasan Minggu malam, dan saat siklus tutup.'),
        h('div', { class: 'kirim', style: 'margin-top:12px' },
          h('button', { class: 'tombol utama', type: 'button', onclick: function (e) { aktifkanNotif(e.currentTarget); } }, 'Aktifkan notifikasi'))
      ];
    }
    var notif = h('section', { class: 'bagian' }, h('h2', null, 'Notifikasi'), isiNotif);

    var data = h('section', { class: 'bagian' }, h('h2', null, 'Data'),
      h('div', { class: 'sakelar' }, h('span', null, h('span', { style: 'font-weight:650' }, 'Ringkasan dan riwayat'),
        h('p', { class: 'kecil' }, d.waktu ? 'Diperbarui ' + waktuRelatif(d.waktu) + '.' : 'Belum diambil.')),
        h('button', { class: 'tombol kecil', type: 'button', onclick: function () { muatData({ dariPengguna: true }); } }, 'Muat ulang')),
      h('div', { class: 'sakelar' }, h('span', null, h('span', { style: 'font-weight:650' }, 'Saran kategori'),
        h('p', { class: 'kecil' }, S.kamus ? 'Dipelajari dari ' + angkaID.format(S.kamus.data.jumlah_baris) + ' catatan, diperbarui ' + waktuRelatif(S.kamus.waktu) + '.' : 'Belum ada.')),
        h('button', { class: 'tombol kecil', type: 'button', onclick: function () { muatData({ dariPengguna: true, kamus: true }); } }, 'Perbarui')));

    var par = r && r.parameter, angka = null;
    if (par) {
      var daftar = [['Gaji per bulan', rp(par.gaji) + ' sejak ' + tglPanjang(par.gaji_mulai)],
        ['Cicilan mobil', rp(par.cicilan)], ['Transfer ke istri', rp(par.transfer_istri)],
        ['Tanggal gajian', 'tiap tanggal ' + par.tanggal_gajian], ['Target tabungan', Math.round(par.target_tabungan * 100) + '% dari pemasukan'],
        ['Sisa gaji setelah rata-rata belanja', rp(par.saldo_bulanan)], ['Rasio cicilan terhadap gaji', persen(par.rasio_cicilan)]];
      angka = h('section', { class: 'bagian' }, h('h2', null, 'Angka yang dipakai'),
        h('ul', { class: 'buku' }, daftar.map(function (x) {
          return h('li', null, h('div', { class: 'baris' }, h('span', { class: 'nama', style: 'font-weight:500' }, x[0]), h('span', { class: 'jumlah' }, x[1])));
        })),
        h('p', { class: 'kecil', style: 'margin-top:8px' }, 'Diubah di Code.gs bagian PENGATURAN. Samakan dengan config_uang.json di laptop supaya dashboard, Telegram, dan aplikasi ini sepakat.'));
    }

    var kode = h('textarea', { class: 'masukan', rows: '3', 'aria-label': 'Kode pasang baru', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Tempel kode pasang baru' });
    var konfirmasi = h('input', { class: 'masukan', 'aria-label': 'Ketik LUPAKAN untuk konfirmasi', autocapitalize: 'characters', placeholder: 'Ketik LUPAKAN' });
    var perangkat = h('section', { class: 'bagian' }, h('h2', null, 'Sambungan'),
      h('p', { class: 'kecil' }, 'Server ' + (S.konfig.api.replace(/^https:\/\/script\.google\.com\/macros\/s\//, '').slice(0, 10) + '…') +
        (d.versi ? ', versi server ' + d.versi : '') + ', versi aplikasi ' + VERSI_APP + '.'),
      h('div', { class: 'chip-grup', style: 'margin-top:10px' },
        h('button', { class: 'tombol kecil', type: 'button', onclick: function (e) {
          var t = e.currentTarget, mulai = Date.now(); t.classList.add('memuat');
          panggil('ping', {}, { metode: 'GET' }).then(function (p) { kabar('Tersambung ke server versi ' + p.versi + ' (' + (Date.now() - mulai) + ' ms).'); },
            function (er) { kabar(er.message); }).then(function () { t.classList.remove('memuat'); });
        } }, 'Periksa sambungan')),
      h('div', { class: 'isian' }, h('span', { class: 'label' }, 'Ganti kode pasang'), kode,
        h('button', { class: 'tombol kecil', type: 'button', onclick: function () {
          var k = bacaKodePasang(kode.value);
          if (!k) { kabar('Kode tidak dikenali.'); return; }
          simpanKonfig(k); S.data = null; simpan.hapus('data'); muatData(); kabar('Kode baru dipakai.'); render();
        } }, 'Pakai kode ini')),
      h('div', { class: 'isian' }, h('span', { class: 'label' }, 'Lupakan HP ini'),
        h('p', { class: 'bantu' }, 'Menghapus kode, salinan data, dan langganan notifikasi HP ini. Catatan di Google Sheet tidak tersentuh.'),
        konfirmasi,
        h('button', { class: 'tombol kecil bahaya', type: 'button', onclick: function () {
          if (konfirmasi.value.trim().toUpperCase() !== 'LUPAKAN') { kabar('Ketik LUPAKAN dulu untuk mengonfirmasi.'); konfirmasi.focus(); return; }
          lupakan();
        } }, 'Lupakan HP ini')));

    return h('div', null, kepala('Atur', null, false), hp, notif, data, angka, perangkat);
  }

  function lupakan() {
    var selesai = function () {
      ['konfig', 'data', 'kamus', 'antre', 'gagal', 'draf', 'tolakNotif'].forEach(simpan.hapus);
      if (window.caches) caches.delete('kas-konfig');
      S.konfig = null; S.data = null; S.kamus = null; S.model = null; S.antre = []; S.gagal = [];
      location.hash = '';
      render();
    };
    langgananPush().then(function (sub) { return sub ? sub.unsubscribe() : null; })
      .then(function () { return panggil('berhenti', { perangkat: S.perangkat.id }).catch(function () { /* tetap lanjut */ }); })
      .then(selesai, selesai);
  }

  // ================================================================ service worker
  function pasangSw() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () { /* http tanpa localhost */ });
    navigator.serviceWorker.addEventListener('message', function (e) {
      var d = e.data || {};
      if (d.jenis === 'push') muatData();
      if (d.jenis === 'buka' && d.url) location.hash = d.url;
    });
    var punyaPengendali = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!punyaPengendali) { punyaPengendali = true; return; }
      // Versi baru terpasang. Muat ulang kalau tidak sedang mengisi form.
      var sibuk = tabKini() === 'catat' && S.catat && (S.catat.nominal || S.catat.ket);
      if (sibuk) S.perluMuatUlang = true; else location.reload();
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !S.konfig) return;
    if (S.perluMuatUlang && tabKini() !== 'catat') { location.reload(); return; }
    kirimAntre();
    if (!S.data || Date.now() - S.data.waktu > 60000) muatData();
  });
  window.addEventListener('online', function () { kirimAntre(); muatData(); });

  // ================================================================ mulai
  terapkanKodeDariUrl();
  if (S.konfig) salinKonfigKeSw();
  pasangSw();
  render();
  if (S.konfig) {
    kirimAntre();
    muatData();
  }
  window.__kas = { S: S, render: render, muatData: muatData };
})();
