/*
 * Service worker Kas Rumah.
 *  - Menyimpan kerangka aplikasi supaya terbuka tanpa sinyal.
 *  - Menampilkan notifikasi. Isinya biasanya ikut terenkripsi di dalam push;
 *    kalau push datang kosong, pesannya diambil dari server (aksi=kotak).
 * Ganti VERSI tiap kali berkas aplikasi diubah supaya HP mengambil yang baru.
 */
var VERSI = 'kas-2026.11.24';
var ASET = [
  './', './index.html', './gaya.css', './app.js', './saran.js', './manifest.webmanifest',
  './font/plus-jakarta-sans.woff2', './ikon/ikon-192.png', './ikon/apple-touch-icon.png', './ikon/lencana-96.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSI).then(function (c) { return c.addAll(ASET); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (daftar) {
    return Promise.all(daftar.filter(function (k) { return k !== VERSI && k !== 'kas-konfig'; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // API Google: langsung ke jaringan
  if (req.mode === 'navigate') {
    // ?pasang=... dan #tab tetap memakai index.html yang tersimpan
    e.respondWith(caches.match('./index.html', { ignoreSearch: true }).then(function (r) {
      return r || fetch(req);
    }).catch(function () { return fetch(req); }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (r) {
    return r || fetch(req).then(function (res) {
      if (res.ok && url.pathname.indexOf('/__konfig') < 0) {
        var salin = res.clone();
        caches.open(VERSI).then(function (c) { c.put(req, salin); });
      }
      return res;
    });
  }));
});

function konfig() {
  return caches.open('kas-konfig').then(function (c) { return c.match('./__konfig'); })
    .then(function (r) { return r ? r.json() : null; });
}

function ambilDariKotak() {
  return konfig().then(function (k) {
    if (!k) return null;
    var q = 'aksi=kotak&kunci=' + encodeURIComponent(k.kunci) + '&perangkat=' + encodeURIComponent(k.perangkat);
    return fetch(k.api + '?' + q, { cache: 'no-store', redirect: 'follow' })
      .then(function (res) { return res.json(); })
      .then(function (j) { return j && j.ok && j.data.pesan && j.data.pesan.length ? j.data.pesan[0] : null; });
  }).catch(function () { return null; });
}

function bacaIsi(data) {
  if (!data) return null;
  try { var j = data.json(); return j && j.judul ? j : null; } catch (e) { return null; }
}

self.addEventListener('push', function (e) {
  var langsung = bacaIsi(e.data);
  e.waitUntil((langsung ? Promise.resolve(langsung) : ambilDariKotak()).then(function (p) {
    p = p || { id: 'umum', judul: 'Kas Rumah', isi: 'Ada kabar baru soal jatah belanja. Buka aplikasi untuk melihatnya.', url: '#ringkas' };
    var lencana = Promise.resolve();
    if (typeof p.lencana === 'number' && self.navigator && self.navigator.setAppBadge) {
      lencana = (p.lencana > 0 ? self.navigator.setAppBadge(p.lencana) : self.navigator.clearAppBadge()).catch(function () {});
    }
    return lencana.then(function () {
      return self.registration.showNotification(p.judul, {
        body: p.isi,
        tag: p.id || 'kas',
        icon: 'ikon/ikon-192.png',
        badge: 'ikon/lencana-96.png',
        timestamp: Date.parse(p.waktu) || Date.now(),
        data: { url: p.url || '#ringkas' }
      });
    }).then(function () {
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    }).then(function (daftar) {
      daftar.forEach(function (c) { c.postMessage({ jenis: 'push', pesan: p }); });
    });
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var tujuan = (e.notification.data && e.notification.data.url) || '#ringkas';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (daftar) {
    for (var i = 0; i < daftar.length; i++) {
      if ('focus' in daftar[i]) {
        daftar[i].postMessage({ jenis: 'buka', url: tujuan });
        return daftar[i].focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(new URL('./' + tujuan, self.registration.scope).href);
  }));
});
