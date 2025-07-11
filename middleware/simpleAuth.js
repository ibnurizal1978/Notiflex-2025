const { supabase } = require('../supabaseClient');

// Simple middleware untuk cek akses menu tanpa redirect loop
function simpleMenuCheck(requiredMenuUrl) {
  return async function(req, res, next) {
    try {
      // Skip untuk halaman yang tidak perlu proteksi
      if (req.path === '/dashboard') {
        return next();
      }
      
      const { data: menuUser, error } = await supabase
        .from('menu_user')
        .select('menu_id')
        .eq('user_id', req.session.user.id);
      
      if (error || !menuUser || menuUser.length === 0) {
        console.log('No menu access found, allowing access to:', req.path);
        return next();
      }
      
      const menuIds = menuUser.map(mu => mu.menu_id);
      
      const { data: menus, error: menuError } = await supabase
        .from('menus')
        .select('url')
        .in('id', menuIds);
      
      if (menuError || !menus) {
        console.log('Error fetching menus, allowing access to:', req.path);
        return next();
      }
      
      const userMenuUrls = menus.map(m => m.url);
      const hasAccess = userMenuUrls.includes(requiredMenuUrl);
      
      if (!hasAccess) {
        console.log('Access denied for:', req.path, 'Required menu:', requiredMenuUrl);
        req.session.errorMessage = 'You do not have access to this page.';
        return res.redirect('/dashboard');
      }
      
      next();
    } catch (error) {
      console.error('Error in simpleMenuCheck:', error);
      next(); // Allow access on error
    }
  };
}

module.exports = {
  simpleMenuCheck
}; 