const { supabase } = require('../supabaseClient');

// Konfigurasi halaman yang selalu bisa diakses (tanpa proteksi menu)
let PUBLIC_PATHS = [
  '/dashboard' // Dashboard utama selalu bisa diakses
];

// Fungsi untuk menambah halaman public
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

// Fungsi untuk mendapatkan semua public paths
function getPublicPaths() {
  return [...PUBLIC_PATHS];
}

// Helper function untuk proteksi halaman berdasarkan menu URL
async function protectPage(requiredMenuUrl) {
  return async function(req, res, next) {
    try {
      const { data: menuUser, error } = await supabase
        .from('menu_user')
        .select('menu_id')
        .eq('user_id', req.session.user.id);
      
      if (error) {
        console.error('Error checking menu access:', error);
        req.session.errorMessage = 'Error checking access permissions.';
        res.redirect('/dashboard');
        return;
      }
      
      const menuIds = menuUser ? menuUser.map(mu => mu.menu_id) : [];
      
      if (menuIds.length === 0) {
        req.session.errorMessage = 'You do not have access to that page.';
        return res.redirect('/unauthorized');
      }
      
      // Ambil detail menu berdasarkan menu_id
      const { data: menus, error: menuError } = await supabase
        .from('menus')
        .select('url')
        .in('id', menuIds);
      
      if (menuError) {
        console.error('Error fetching menu details:', menuError);
        req.session.errorMessage = 'Error checking access permissions.';
        res.redirect('/dashboard');
        return;
      }
      
      const userMenuUrls = menus ? menus.map(m => m.url) : [];
      
      if (!userMenuUrls.includes(requiredMenuUrl)) {
        req.session.errorMessage = 'You do not have access to that page.';
        return res.redirect('/unauthorized');
      }
      
      next();
    } catch (error) {
      console.error('Error checking menu access:', error);
      req.session.errorMessage = 'Error checking access permissions.';
      res.redirect('/dashboard');
    }
  };
}

// Helper function untuk proteksi multiple menu URLs
async function protectPageMultiple(requiredMenuUrls) {
  return async function(req, res, next) {
    try {
      const { data: menuUser, error } = await supabase
        .from('menu_user')
        .select('menu_id')
        .eq('user_id', req.session.user.id);
      
      if (error) {
        console.error('Error checking menu access:', error);
        req.session.errorMessage = 'Error checking access permissions.';
        res.redirect('/dashboard');
        return;
      }
      
      const menuIds = menuUser ? menuUser.map(mu => mu.menu_id) : [];
      
      if (menuIds.length === 0) {
        req.session.errorMessage = 'You do not have access to that page.';
        return res.redirect('/unauthorized');
      }
      
      // Ambil detail menu berdasarkan menu_id
      const { data: menus, error: menuError } = await supabase
        .from('menus')
        .select('url')
        .in('id', menuIds);
      
      if (menuError) {
        console.error('Error fetching menu details:', menuError);
        req.session.errorMessage = 'Error checking access permissions.';
        res.redirect('/dashboard');
        return;
      }
      
      const userMenuUrls = menus ? menus.map(m => m.url) : [];
      
      const hasAccess = requiredMenuUrls.some(menuUrl => 
        userMenuUrls.includes(menuUrl)
      );
      
      if (!hasAccess) {
        req.session.errorMessage = 'You do not have access to that page.';
        return res.redirect('/unauthorized');
      }
      
      next();
    } catch (error) {
      console.error('Error checking menu access:', error);
      req.session.errorMessage = 'Error checking access permissions.';
      res.redirect('/dashboard');
    }
  };
}

// Helper function untuk cek akses tanpa redirect (return boolean)
async function hasMenuAccess(userId, requiredMenuUrl) {
  try {
    const { data: menuUser, error } = await supabase
      .from('menu_user')
      .select('menu_id')
      .eq('user_id', userId);
    
    if (error) {
      console.error('Error checking menu access:', error);
      return false;
    }
    
    const menuIds = menuUser ? menuUser.map(mu => mu.menu_id) : [];
    
    if (menuIds.length === 0) {
      return false;
    }
    
    // Ambil detail menu berdasarkan menu_id
    const { data: menus, error: menuError } = await supabase
      .from('menus')
      .select('url')
      .in('id', menuIds);
    
    if (menuError) {
      console.error('Error fetching menu details:', menuError);
      return false;
    }
    
    const userMenuUrls = menus ? menus.map(m => m.url) : [];
    return userMenuUrls.includes(requiredMenuUrl);
  } catch (error) {
    console.error('Error checking menu access:', error);
    return false;
  }
}

// Helper function untuk membuat halaman public sementara
function makePublic(routePath) {
  addPublicPath(routePath);
  console.log(`Route ${routePath} is now public`);
}

// Helper function untuk membuat halaman protected
function makeProtected(routePath) {
  removePublicPath(routePath);
  console.log(`Route ${routePath} is now protected`);
}

module.exports = {
  protectPage,
  protectPageMultiple,
  hasMenuAccess,
  addPublicPath,
  removePublicPath,
  getPublicPaths,
  makePublic,
  makeProtected
}; 