# 🛡️ Panduan Proteksi Halaman

Sistem proteksi halaman ini memastikan user hanya bisa mengakses halaman yang sesuai dengan menu yang dimilikinya.

## 🔧 Cara Kerja

1. **Automatic Protection**: Semua route `/dashboard/*` otomatis dicek berdasarkan menu user
2. **Manual Protection**: Gunakan helper functions untuk proteksi yang lebih spesifik
3. **Flexible Public Paths**: Sistem yang fleksibel untuk mengatur halaman mana yang bisa diakses tanpa proteksi
4. **Error Handling**: User yang tidak punya akses akan di-redirect ke dashboard dengan pesan error

## 📝 Cara Penggunaan

### 1. Proteksi Otomatis (Sudah Aktif)
Semua halaman di `/dashboard/*` sudah otomatis diproteksi berdasarkan menu user.

### 2. Proteksi Manual untuk Halaman Baru

#### A. Import Helper Functions
```javascript
const { 
  protectPage, 
  protectPageMultiple, 
  hasMenuAccess,
  makePublic,
  makeProtected 
} = require('../middleware/auth');
```

#### B. Proteksi Satu Menu
```javascript
// User harus punya menu dengan URL '/reports'
router.get('/reports', protectPage('/reports'), (req, res) => {
  res.render('reports');
});
```

#### C. Proteksi Multiple Menu
```javascript
// User harus punya salah satu dari menu ini
router.get('/admin', protectPageMultiple(['/admin', '/settings']), (req, res) => {
  res.render('admin');
});
```

#### D. Proteksi Manual di Dalam Route
```javascript
router.get('/custom', async (req, res) => {
  const hasAccess = await hasMenuAccess(req.session.user.id, '/users');
  
  if (!hasAccess) {
    req.session.errorMessage = 'You need users access.';
    return res.redirect('/dashboard');
  }
  
  res.render('custom');
});
```

### 3. Mengatur Halaman Public/Protected

#### A. Membuat Halaman Public (Tidak Diproteksi)
```javascript
// Di awal file route
const { makePublic } = require('../middleware/auth');

// Buat halaman ini bisa diakses tanpa menu
makePublic('/dashboard/help');
makePublic('/dashboard/faq');

router.get('/help', (req, res) => {
  res.render('help'); // Bisa diakses semua user yang sudah login
});
```

#### B. Membuat Halaman Protected (Diproteksi)
```javascript
// Di awal file route
const { makeProtected } = require('../middleware/auth');

// Buat halaman ini diproteksi (default behavior)
makeProtected('/dashboard/users/create'); // Sekarang butuh menu access

router.get('/users/create', (req, res) => {
  res.render('users-create'); // Sekarang diproteksi
});
```

#### C. Cek Status Halaman
```javascript
const { getPublicPaths } = require('../middleware/auth');

console.log('Public paths:', getPublicPaths());
// Output: ['/dashboard', '/dashboard/help', '/dashboard/faq']
```

## 🎯 Contoh Praktis

### Halaman Reports (Protected)
```javascript
// routes/reports.js
const express = require('express');
const router = express.Router();
const { protectPage } = require('../middleware/auth');

router.get('/', protectPage('/reports'), (req, res) => {
  res.render('reports/index');
});

router.get('/export', protectPage('/reports'), (req, res) => {
  res.render('reports/export');
});

module.exports = router;
```

### Halaman Settings (Protected)
```javascript
// routes/settings.js
const express = require('express');
const router = express.Router();
const { protectPageMultiple } = require('../middleware/auth');

// Bisa diakses dengan menu '/settings' atau '/admin'
router.get('/', protectPageMultiple(['/settings', '/admin']), (req, res) => {
  res.render('settings');
});

module.exports = router;
```

### Halaman Help (Public)
```javascript
// routes/help.js
const express = require('express');
const router = express.Router();
const { makePublic } = require('../middleware/auth');

// Buat halaman help bisa diakses semua user
makePublic('/dashboard/help');

router.get('/', (req, res) => {
  res.render('help'); // Bisa diakses tanpa menu access
});

module.exports = router;
```

## 🔍 Debugging

### Cek Menu User
```javascript
// Di route handler
console.log('User menus:', res.locals.menus);
```

### Cek Akses Manual
```javascript
const hasAccess = await hasMenuAccess(userId, '/menu-url');
console.log('Has access:', hasAccess);
```

### Cek Public Paths
```javascript
const { getPublicPaths } = require('../middleware/auth');
console.log('Public paths:', getPublicPaths());
```

## ⚠️ Catatan Penting

1. **Dashboard selalu bisa diakses** - User yang sudah login selalu bisa akses `/dashboard`
2. **Semua halaman lain diproteksi** - Termasuk `/dashboard/users/create` sekarang diproteksi
3. **Error message otomatis** - Pesan error akan muncul di dashboard
4. **Redirect otomatis** - User tanpa akses akan di-redirect ke dashboard
5. **Fleksibel** - Bisa mengatur halaman mana yang public/protected

## 🚀 Tips Penggunaan

1. **Gunakan URL yang konsisten** - Pastikan URL di table `menus` sama dengan route
2. **Test dengan user berbeda** - Cek dengan user yang punya menu berbeda
3. **Log untuk debugging** - Gunakan `console.log` untuk cek menu user
4. **Pesan error yang jelas** - Berikan pesan error yang informatif
5. **Gunakan makePublic dengan hati-hati** - Hanya untuk halaman yang benar-benar perlu diakses semua user

## 📋 Checklist Halaman Baru

- [ ] Import helper functions
- [ ] Tentukan apakah halaman public atau protected
- [ ] Jika public: gunakan `makePublic('/path')`
- [ ] Jika protected: gunakan `protectPage('/menu-url')`
- [ ] Test dengan user yang punya akses
- [ ] Test dengan user yang tidak punya akses
- [ ] Pastikan pesan error muncul
- [ ] Pastikan redirect ke dashboard berfungsi

## 🔧 Konfigurasi Default

### Halaman yang Selalu Public:
- `/dashboard` - Dashboard utama

### Halaman yang Diproteksi (Default):
- `/dashboard/users` - Butuh menu '/users'
- `/dashboard/users/create` - Butuh menu '/users'
- `/dashboard/reports` - Butuh menu '/reports'
- Dan semua halaman dashboard lainnya 