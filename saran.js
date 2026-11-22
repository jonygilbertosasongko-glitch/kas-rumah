/*
 * Saran kategori untuk form Catat.
 *
 * Kamus disusun server (kamus_ di Code.gs) dari catatan lama: berapa kali
 * tiap kata di Keterangan muncul bersama tiap Jenis Pengeluaran, Siapa, dan
 * Kategori Kebutuhan, dengan bobot yang meluruh setengah tiap 12 bulan.
 * Di sini kamus dipakai sebagai Naive Bayes: cepat, jalan offline, dan
 * cukup akurat untuk keterangan pendek seperti "nasi padang, es teh".
 *
 * fitur() HARUS sama persis dengan fitur_() di Code.gs.
 */
(function (root) {
  'use strict';

  var KATA_ABAIKAN = ['dan', 'yang', 'untuk', 'buat', 'beli', 'bayar', 'dll', 'lain', 'lainnya',
    'dari', 'sama', 'pak', 'bu', 'mas', 'mbak', 'the', 'dengan', 'atau', 'per', 'isi', 'via'];

  function fitur(teks) {
    var t = String(teks || '').toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/rp\.?\s*[\d.,]+/g, ' ')
      .replace(/\d[\d.,]*\s*(rb|ribu|k|jt|juta)?\b/g, ' ');
    var item = t.split(/[,;\n\/+&]|\bdan\b/).map(function (s) {
      return s.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    }).filter(function (s) { return s.length >= 2; });
    var hasil = {};
    item.forEach(function (it) {
      var kata = it.split(' ').filter(function (w) { return w.length >= 3 && KATA_ABAIKAN.indexOf(w) < 0; });
      kata.forEach(function (w) { hasil[w] = true; });
      if (kata.length >= 2 && kata.length <= 4) hasil['#' + kata.join(' ')] = true;
    });
    return { item: item, fitur: Object.keys(hasil) };
  }

  function keObj(arr) {
    var o = {};
    for (var i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1];
    return o;
  }

  /** Ubah kamus mentah (hemat ukuran) jadi struktur siap hitung. */
  function siapkan(kamus) {
    if (!kamus || !kamus.label) return null;
    var m = { label: kamus.label, F: {}, total: {}, prior: {}, bersama: kamus.bersama || { siapa: {}, prio: {} },
              frasa: kamus.frasa || [], V: 0 };
    ['kat', 'siapa', 'prio'].forEach(function (j) {
      m.total[j] = keObj(kamus.total[j]);
      m.prior[j] = keObj(kamus.prior[j]);
    });
    Object.keys(kamus.fitur).forEach(function (f) {
      var e = kamus.fitur[f];
      m.F[f] = { kat: keObj(e[0]), siapa: keObj(e[1]), prio: keObj(e[2]) };
      m.V++;
    });
    return m;
  }

  // Diuji pada catatan 2026 yang tidak ikut menyusun kamus (uji/saran_eval.js):
  // prior diratakan (RHO 0,5) supaya "Makan" yang paling sering tidak menelan
  // kata-kata langka tapi tegas seperti "spp" atau "token".
  var ALFA = 0.1, RHO = 0.5;
  // Di atas ambang ini tebakan Jenis Pengeluaran benar ±88% dan langsung dipilih.
  var AMBANG_PILIH = 0.7;

  function nilai(m, j, fs, tambahan) {
    var L = m.label[j], P = m.prior[j], T = m.total[j], totP = 0, c, k;
    for (c = 0; c < L.length; c++) totP += P[c] || 0;
    var hasil = [];
    for (c = 0; c < L.length; c++) {
      var s = RHO * Math.log(((P[c] || 0) + 1) / (totP + L.length));
      for (k = 0; k < fs.length; k++) {
        var e = m.F[fs[k]];
        if (e) s += Math.log(((e[j][c] || 0) + ALFA) / ((T[c] || 0) + ALFA * m.V));
      }
      if (tambahan) s += tambahan(c);
      hasil.push({ i: c, nama: L[c], s: s });
    }
    return hasil;
  }

  function normal(hasil, boleh) {
    if (boleh && boleh.length) {
      var kecil = boleh.map(function (b) { return String(b).trim().toLowerCase(); });
      hasil = hasil.filter(function (h) { return kecil.indexOf(String(h.nama).trim().toLowerCase()) >= 0; });
    }
    if (!hasil.length) return [];
    var maks = -Infinity, jml = 0;
    hasil.forEach(function (h) { if (h.s > maks) maks = h.s; });
    hasil.forEach(function (h) { h.p = Math.exp(h.s - maks); jml += h.p; });
    hasil.forEach(function (h) { h.p /= jml; delete h.s; });
    return hasil.sort(function (a, b) { return b.p - a.p; });
  }

  /** Bobot Siapa/Kebutuhan berdasarkan Jenis Pengeluaran yang dipilih. */
  function dariKategori(m, j, kat, lambda) {
    var ki = m.label.kat.indexOf(kat);
    if (ki < 0 || !lambda) return null;
    var L = m.label[j], tabel = m.bersama[j] || {}, tot = 0, c;
    for (c = 0; c < L.length; c++) tot += tabel[ki + ':' + c] || 0;
    if (!tot) return null;
    return function (c) { return lambda * Math.log(((tabel[ki + ':' + c] || 0) + 0.5) / (tot + 0.5 * L.length)); };
  }

  /**
   * Tebak isian dari keterangan.
   * opsi.boleh   : { kat: [...], siapa: [...], prio: [...] } pilihan yang ada di form
   * opsi.kategori: kategori yang sudah dipilih orangnya (untuk menebak Siapa/Kebutuhan)
   * Hasil: { dikenal, kat: [{nama, p}], siapa: [...], prio: [...] }
   */
  function tebak(m, teks, opsi) {
    opsi = opsi || {};
    var boleh = opsi.boleh || {};
    var fs = fitur(teks).fitur, dikenal = 0;
    if (!m) return { dikenal: 0, kat: [], siapa: [], prio: [] };
    fs.forEach(function (f) { if (m.F[f]) dikenal++; });
    var kat = normal(nilai(m, 'kat', fs), boleh.kat);
    var acuan = opsi.kategori || (kat[0] && kat[0].p >= AMBANG_PILIH ? kat[0].nama : null);
    return {
      dikenal: dikenal,
      kat: kat,
      siapa: normal(nilai(m, 'siapa', fs, dariKategori(m, 'siapa', acuan, 1)), boleh.siapa),
      prio: normal(nilai(m, 'prio', fs, dariKategori(m, 'prio', acuan, 1)), boleh.prio)
    };
  }

  /** Potongan terakhir yang sedang diketik (dipisah koma). */
  function potonganAkhir(teks) {
    var s = String(teks || '');
    var i = Math.max(s.lastIndexOf(','), s.lastIndexOf(';'));
    return { awal: i >= 0 ? s.slice(0, i + 1) : '', akhir: (i >= 0 ? s.slice(i + 1) : s).replace(/^\s+/, '') };
  }

  /**
   * Usulan pelengkap untuk potongan terakhir: frasa yang pernah ditulis,
   * dengan nominal yang biasa dan isian yang biasa menyertainya.
   */
  function lengkapi(m, teks, batas) {
    if (!m) return [];
    var akhir = potonganAkhir(teks).akhir.toLowerCase().replace(/\s+/g, ' ');
    if (akhir.length < 2) return [];
    var kataKetik = akhir.split(' ');
    var hasil = [];
    m.frasa.forEach(function (fr) {
      var f = fr[0], skor = 0;
      if (f === akhir) return;
      if (f.indexOf(akhir) === 0) skor = 3;
      else {
        var kata = f.split(' '), cocok = kataKetik.every(function (k) {
          return kata.some(function (w) { return w.indexOf(k) === 0; });
        });
        if (cocok) skor = 1;
      }
      if (skor) hasil.push({ teks: f, skor: skor + Math.log(1 + fr[1]), nominal: fr[2],
        kat: fr[3] >= 0 ? m.label.kat[fr[3]] : null, siapa: fr[4] >= 0 ? m.label.siapa[fr[4]] : null,
        prio: fr[5] >= 0 ? m.label.prio[fr[5]] : null, terakhir: fr[6] });
    });
    return hasil.sort(function (a, b) { return b.skor - a.skor; }).slice(0, batas || 4);
  }

  /** Ganti potongan terakhir dengan frasa pilihan. */
  function pasangFrasa(teks, frasa) {
    var p = potonganAkhir(teks);
    return (p.awal ? p.awal + ' ' : '') + frasa;
  }

  var Saran = { fitur: fitur, siapkan: siapkan, tebak: tebak, lengkapi: lengkapi, pasangFrasa: pasangFrasa,
                potonganAkhir: potonganAkhir, AMBANG_PILIH: AMBANG_PILIH };
  root.Saran = Saran;
  if (typeof module !== 'undefined' && module.exports) module.exports = Saran;
})(typeof self !== 'undefined' ? self : this);
