// app.js
require('dotenv').config();
// Import modul Express.
// Express adalah framework web minimalis untuk Node.js yang memudahkan pembuatan server.
const express = require('express');
const path = require('path');
const session = require('express-session');
const pg = require('pg'); // PostgreSQL client
const pgSession = require('connect-pg-simple')(session);
const { supabase } = require('./supabaseClient');
const pgConnection = process.env.DATABASE_URL;

// Konfigurasi koneksi Pool PostgreSQL
const pgPool = new pg.Pool({
  connectionString: pgConnection,
  // ssl: {
  //     rejectUnauthorized: false // Hanya jika Anda menghadapi masalah SSL di lingkungan development/beberapa host
  // }
});

// Membuat instance aplikasi Express.
// 'app' adalah objek utama yang akan kita gunakan untuk mengkonfigurasi server.
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Inisialisasi session store
app.use(session({
  store: new pgSession({
      pool: pgPool,                // Konfigurasi pool PostgreSQL Anda
      tableName: 'session',        // Nama tabel sesi yang Anda buat
      // Insert optional options here (e.g. `createTableIfMissing` boolean to automatically create the session table)
  }),
  secret: process.env.SESSION_SECRET || 'your-very-secret-key', // HARUS DISET DENGAN NILAI UNIK DAN KUAT DI VERCEL
  resave: false,               // Tidak menyimpan sesi kembali ke store jika tidak ada perubahan
  saveUninitialized: false,    // Tidak menyimpan sesi yang baru tapi belum diinisialisasi (misal, tanpa login)
  cookie: {
      secure: process.env.NODE_ENV === 'production', // true di production (HTTPS), false di localhost (HTTP)
      httpOnly: true, // Mencegah akses cookie dari JavaScript sisi klien
      maxAge: 1000 * 60 * 60 * 24 // 1 hari
  }
}));

// Routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const itemsRouter = require('./routes/items');

// Konfigurasi halaman yang selalu bisa diakses (tanpa proteksi menu)
const PUBLIC_PATHS = [
  '/dashboard', // Dashboard utama selalu bisa diakses
  '/dashboard/users', // Users page
  '/dashboard/users/create' // Users create page
];

// Fungsi untuk menambah halaman public (bisa dipanggil dari route lain)
function addPublicPath(path) {
  if (!PUBLIC_PATHS.includes(path)) {
    PUBLIC_PATHS.push(path);
  }
}

// Fungsi untuk menghapus halaman public
function removePublicPath(path) {
  const index = PUBLIC_PATHS.indexOf(path);
  if (index > -1) {
    PUBLIC_PATHS.splice(index, 1);
  }
}

// Middleware: cek session user
function requireAuth(req, res, next) {
  console.log('requireAuth check:', req.path, 'User session:', !!req.session.user);
  if (!req.session.user || !req.session.user.id) {
    console.log('No user session, redirecting to login');
    return res.redirect('/login');
  }
  
  // Pass user data to templates
  res.locals.user = req.session.user;
  
  next();
}

// Middleware: ambil menu_user dan menus, simpan di res.locals.menus
async function attachMenus(req, res, next) {
  if (req.session.user && req.session.user.id) {
    try {
      const { data: menuUser, error } = await supabase
        .from('menu_user')
        .select('menu_id')
        .eq('user_id', req.session.user.id);
      
      if (error) {
        console.error('Error fetching menus:', error);
        res.locals.menus = [];
      } else {
        const menuIds = menuUser ? menuUser.map(mu => mu.menu_id) : [];
        let menus = [];
        if (menuIds.length > 0) {
          const { data: menuList, error: menuError } = await supabase
            .from('menus')
            .select('*')
            .in('id', menuIds);
          
          if (menuError) {
            console.error('Error fetching menu list:', menuError);
            menus = [];
          } else {
            menus = menuList || [];
          }
        }
        res.locals.menus = menus;
        console.log('Attached menus for user:', req.session.user.id, 'Menu count:', menus.length);
      }
    } catch (error) {
      console.error('Error in attachMenus:', error);
      res.locals.menus = [];
    }
  } else {
    res.locals.menus = [];
  }
  next();
}

// Middleware: pass error messages dari session ke template
function attachMessages(req, res, next) {
  res.locals.errorMessage = req.session.errorMessage;
  res.locals.successMessage = req.session.successMessage;
  
  // Pass user data to all templates
  if (req.session.user) {
    res.locals.user = req.session.user;
  }
  
  // Clear messages setelah dipass ke template
  delete req.session.errorMessage;
  delete req.session.successMessage;
  
  next();
}

// Helper function untuk proteksi halaman (bisa digunakan di route handler)
async function protectPage(req, res, next, requiredMenuUrl) {
  const { data: menuUser } = await supabase
    .from('menu_user')
    .select(`
      menu_id,
      menus!inner(url)
    `)
    .eq('user_id', req.session.user.id);
  
  const userMenuUrls = menuUser ? menuUser.map(mu => mu.menus.url) : [];
  
  if (!userMenuUrls.includes(requiredMenuUrl)) {
    req.session.errorMessage = 'You do not have access to this page.';
    return res.redirect('/dashboard');
  }
  
  next();
}

// Middleware: cek akses menu berdasarkan URL path
async function checkMenuAccess(req, res, next) {
  const currentPath = req.path;
  
  // Skip check untuk halaman yang tidak perlu proteksi
  if (PUBLIC_PATHS.includes(currentPath)) {
    console.log('Public path accessed:', currentPath);
    return next();
  }
  
  // Skip check untuk static assets
  if (currentPath.startsWith('/assets/') || currentPath.startsWith('/css/') || currentPath.startsWith('/js/') || currentPath.startsWith('/images/')) {
    return next();
  }
  
  try {
    // Cek apakah user punya menu yang sesuai dengan path ini
    const { data: menuUser, error } = await supabase
      .from('menu_user')
      .select('menu_id')
      .eq('user_id', req.session.user.id);
    
    if (error) {
      console.error('Error checking menu access:', error);
      // Jika ada error, biarkan user akses (fail-safe)
      console.log('Allowing access due to error for path:', currentPath);
      return next();
    }
    
    const menuIds = menuUser ? menuUser.map(mu => mu.menu_id) : [];
    console.log('User menu IDs for path', currentPath + ':', menuIds);
    
    // Jika user tidak punya menu sama sekali, biarkan akses (fail-safe)
    if (menuIds.length === 0) {
      console.log('User has no menus, allowing access to:', currentPath);
      return next();
    }
    
    // Ambil detail menu berdasarkan menu_id
    const { data: menus, error: menuError } = await supabase
      .from('menus')
      .select('url')
      .in('id', menuIds);
    
    if (menuError) {
      console.error('Error fetching menu details:', menuError);
      // Jika ada error, biarkan user akses (fail-safe)
      console.log('Allowing access due to menu error for path:', currentPath);
      return next();
    }
    
    const userMenuUrls = menus ? menus.map(m => m.url) : [];
    console.log('User menu URLs for path', currentPath + ':', userMenuUrls);
    
    // Cek apakah current path ada di menu user
    const hasAccess = userMenuUrls.some(menuUrl => {
      // Exact match atau path yang dimulai dengan menu URL
      const matches = currentPath === menuUrl || currentPath.startsWith(menuUrl + '/');
      if (matches) {
        console.log('Menu match found:', menuUrl, 'for path:', currentPath);
      }
      return matches;
    });
    
    if (!hasAccess) {
      console.log('Access denied for path:', currentPath, 'User menus:', userMenuUrls);
      // Redirect ke dashboard dengan pesan error
      req.session.errorMessage = 'You do not have access to this page.';
      return res.redirect('/dashboard');
    }
    
    console.log('Access granted for path:', currentPath);
    next();
  } catch (error) {
    console.error('Error in checkMenuAccess:', error);
    // Jika ada error, biarkan user akses (fail-safe)
    console.log('Allowing access due to exception for path:', currentPath);
    next();
  }
}

app.use('/', authRoutes);
// Temporarily disable checkMenuAccess to fix redirect loop
app.use('/dashboard', requireAuth, attachMenus, attachMessages, dashboardRoutes);
app.use('/dashboard/items', itemsRouter);
// app.use('/dashboard', requireAuth, attachMenus, attachMessages, checkMenuAccess, dashboardRoutes);

// Menentukan port di mana server akan berjalan.
// Kita bisa mengambilnya dari variabel lingkungan (process.env.PORT) jika ada (untuk deployment),
// atau menggunakan port 3000 sebagai default.
const PORT = process.env.PORT || 3000;

// Menentukan rute dasar (root route) untuk aplikasi.
// Redirect ke /login (atau ke dashboard jika sudah login, nanti bisa diubah sesuai kebutuhan autentikasi)
app.get('/', (req, res) => {
  if (req.session.user && req.session.user.id) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

app.locals.formatDateTime = function(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

// Menjalankan server dan mendengarkan permintaan pada port yang telah ditentukan.
// Setelah server berhasil berjalan, pesan akan dicetak ke konsol.
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

