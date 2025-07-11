const express = require('express');
const router = express.Router();
const { 
  protectPage, 
  protectPageMultiple, 
  hasMenuAccess,
  makePublic,
  makeProtected,
  getPublicPaths 
} = require('../middleware/auth');

// Contoh 1: Proteksi halaman dengan satu menu URL
// User harus punya menu dengan URL '/users' untuk akses halaman ini
router.get('/protected-users', protectPage('/users'), (req, res) => {
  res.render('protected-users', { 
    title: 'Protected Users Page',
    message: 'This page is protected by menu access'
  });
});

// Contoh 2: Proteksi halaman dengan multiple menu URLs
// User harus punya salah satu dari menu URLs ini untuk akses
router.get('/admin-panel', protectPageMultiple(['/admin', '/settings']), (req, res) => {
  res.render('admin-panel', { 
    title: 'Admin Panel',
    message: 'This page requires admin or settings access'
  });
});

// Contoh 3: Membuat halaman public (tidak diproteksi)
// Halaman ini bisa diakses semua user yang sudah login
makePublic('/dashboard/help');
router.get('/help', (req, res) => {
  res.render('help', { 
    title: 'Help Page',
    message: 'This page is public - all logged in users can access'
  });
});

// Contoh 4: Membuat halaman protected (diproteksi)
// Halaman ini butuh menu access
makeProtected('/dashboard/secret-page');
router.get('/secret-page', protectPage('/admin'), (req, res) => {
  res.render('secret-page', { 
    title: 'Secret Page',
    message: 'This page requires admin access'
  });
});

// Contoh 5: Proteksi dengan pengecekan manual di dalam route
router.get('/dynamic-page', async (req, res) => {
  // Cek akses tanpa redirect
  const hasAccess = await hasMenuAccess(req.session.user.id, '/reports');
  
  if (!hasAccess) {
    req.session.errorMessage = 'You need reports access to view this page.';
    return res.redirect('/dashboard');
  }
  
  res.render('dynamic-page', { 
    title: 'Dynamic Page',
    message: 'This page checks access manually'
  });
});

// Contoh 6: Proteksi dengan custom logic
router.get('/custom-protected', async (req, res) => {
  // Cek multiple akses
  const hasUsersAccess = await hasMenuAccess(req.session.user.id, '/users');
  const hasReportsAccess = await hasMenuAccess(req.session.user.id, '/reports');
  
  if (!hasUsersAccess && !hasReportsAccess) {
    req.session.errorMessage = 'You need either users or reports access.';
    return res.redirect('/dashboard');
  }
  
  res.render('custom-protected', { 
    title: 'Custom Protected Page',
    hasUsersAccess,
    hasReportsAccess
  });
});

// Contoh 7: Debug route untuk cek public paths
router.get('/debug-paths', (req, res) => {
  const publicPaths = getPublicPaths();
  res.json({
    message: 'Current public paths',
    publicPaths: publicPaths,
    currentUser: req.session.user.email
  });
});

module.exports = router; 