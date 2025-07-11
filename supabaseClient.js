const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Supabase URL:', supabaseUrl);
console.log('Supabase Key (anon):', supabaseKey ? 'Set' : 'Not set');
console.log('Supabase Service Key:', supabaseServiceKey ? 'Set' : 'Not set');

const supabase = createClient(supabaseUrl, supabaseKey);

// Create admin client only if service role key is available and different from anon key
let supabaseAdmin = null;
if (supabaseServiceKey && supabaseServiceKey !== supabaseKey) {
  supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  console.log('Admin client created successfully');
} else {
  console.log('Warning: Service role key not available or same as anon key. Admin operations will not work.');
  // Fallback: use regular client for admin operations (this won't work but prevents crashes)
  supabaseAdmin = supabase;
}

module.exports = { supabase, supabaseAdmin }; 