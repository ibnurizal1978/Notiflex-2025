const express = require('express');
const router = express.Router();
const { supabase } = require('../supabaseClient');
const validator = require('validator');

//this is to check if user has data in table or not
async function handleFirstLogin(user) {
  try {
    // Cek apakah user sudah ada di table users
    const { data: existingUser, error: existingUserError } = await supabase
      .from('users')
      .select('id', 'uuid')
      .eq('email', user.email)
      .single();
    if (existingUserError && existingUserError.code !== 'PGRST116') {
      console.error('Supabase existingUserError:', existingUserError);
      throw existingUserError;
    }
    if (existingUser) return;

    // 1. Insert ke clients
    const { data: existingClient, error: checkError } = await supabase
        .from('clients')
        .select('*')
        .eq('name', user.email) // Mencari berdasarkan kolom 'name'
        .single();
    
    if(existingClient) return

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert([{ name: user.email }])
      .select()
      .single();
    console.log('Insert client response:', { client, clientError });
    if (clientError) {
      console.error('Supabase clientError:', clientError);
      throw clientError;
    }

    // 2. Insert ke users
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert([{
        name: user.email,
        email: user.email,
        user_uuid: user.id,
        client_id: client.id
      }])
      .select()
      .single();
    console.log('Insert users response:', { newUser, userError });
    if (userError) {
      console.error('Supabase userError:', userError);
      throw userError;
    }

    // 3. Insert ke menu_user
    const { data: menus, error: menuError } = await supabase.from('menus').select('id');
    if (menuError) {
      console.error('Supabase menuError:', menuError);
      throw menuError;
    }
    const menuUserRows = menus.map(menu => ({
      menu_id: menu.id,
      user_id: newUser.id
    }));
    const { error: menuUserInsertError } = await supabase.from('menu_user').insert(menuUserRows);
    if (menuUserInsertError) {
      console.error('Supabase menuUserInsertError:', menuUserInsertError);
      throw menuUserInsertError;
    }

    // 4. Insert ke object_type_reminder
    const { data: objectTypes, error: objectTypeError } = await supabase.from('object_type').select('id');
    if (objectTypeError) {
      console.error('Supabase objectTypeError:', objectTypeError);
      throw objectTypeError;
    }
    const remindTimes = [30];
    const reminderRows = [];
    objectTypes.forEach(obj => {
      remindTimes.forEach(remind_in => {
        reminderRows.push({
          object_type_id: obj.id,
          remind_in,
          remind_using: 'EMAIL',
          client_id: client.id,
          created_by: newUser.id
        });
      });
    });
    const { error: reminderInsertError } = await supabase.from('object_type_reminder').insert(reminderRows);
    if (reminderInsertError) {
      console.error('Supabase reminderInsertError:', reminderInsertError);
      throw reminderInsertError;
    }
  } catch (err) {
    console.error('handleFirstLogin error:', err);
    throw err;
  }
}

// Login page
router.get('/login', (req, res) => {
  res.render('auth/login');
});

// Signup page
router.get('/signup', (req, res) => {
  res.render('auth/signup');
});

// Signup handler
router.post('/signup', async (req, res) => {
  const email = validator.escape(req.body.email || '')
  const { password, password2 } = req.body;
  // Validasi sederhana
  const errors = [];
  if (!email || !password || !password2) {
    errors.push('All fields are required.');
  }
  if (password !== password2) {
    errors.push('Password and confirmation do not match.');
  }
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters.');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number.');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character.');
  }
  if (errors.length > 0) {
    // Jika ada error validasi, langsung render dan return, jangan signup ke Supabase
    return res.render('auth/signup', { error: errors.join(' ') });
  }
  // Signup ke Supabase Auth
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return res.render('auth/signup', { error: error.message });
  }
  // Sukses, tampilkan notif di login
  res.render('auth/login', { message: 'Sign up successful! Please check your email to verify your account.' });
});

// Forgot password page
router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password');
});

// Login handler (email/password)
router.post('/login', async (req, res) => {
  const email = (req.body.email || '').toString();
  const password = (req.body.password || '').toString();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return res.render('auth/login', { error: error.message });
  }

  // Query userRow dari table users berdasarkan user_uuid (UUID dari Supabase Auth)
  let { data: userRow, error: userRowError } = await supabase
    .from('users')
    .select('*')
    .eq('user_uuid', data.user.id)
    .single();

  // Jika user belum ada, jalankan handleFirstLogin untuk membuat user
  if (userRowError || !userRow) {
    await handleFirstLogin(data.user);
    // Query ulang userRow setelah insert
    ({ data: userRow, error: userRowError } = await supabase
      .from('users')
      .select('*')
      .eq('user_uuid', data.user.id)
      .single());
    if (userRowError || !userRow) {
      return res.render('auth/login', { error: 'User not anjing found in users table after insert.' });
    }

    //if is_active = false then he cannot login
    if(userRow.is_active == false) {
      return res.render('auth/login', { error: 'You have been blocked. Contact your Administrator.' });
    }
  }

  // Update kolom updated_at di table users
  await supabase
    .from('users')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', userRow.id);

  // Simpan seluruh data user ke session (id = id dari table users)
  req.session.user = userRow;
  res.redirect('/dashboard');
});

// Google OAuth login
router.get('/auth/google', (req, res) => {
  console.log('ke /auth/google')
  const redirectTo = `${process.env.SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URL)}&response_type=code`;
  res.redirect(redirectTo);
});

// Google OAuth callback
router.get('/auth/callback', async (req, res) => {
  const { access_token } = req.query;
  if (!access_token) return res.redirect('/login');
  // Ambil user info dari access_token
  const { data, error } = await supabase.auth.getUser(access_token);
  if (error) return res.redirect('/login',  { error: error });
  // Query table users berdasarkan user_uuid (UUID dari Supabase Auth)
  let { data: userRow, error: userRowError } = await supabase
    .from('users')
    .select('*')
    .eq('user_uuid', data.user.id)
    .single();

  // Jika user belum ada, jalankan handleFirstLogin untuk membuat user
  if (userRowError || !userRow) {
    await handleFirstLogin(data.user);
    // Query ulang userRow setelah insert
    ({ data: userRow, error: userRowError } = await supabase
      .from('users')
      .select('*')
      .eq('user_uuid', data.user.id)
      .single());
      
    if (userRowError || !userRow) {
      return res.render('auth/login', { error: 'User not found in users table after insert.' });
    }

    //if is_active = false then he cannot login
    if(userRow.is_active == false) {
      return res.render('auth/login', { error: 'You have been blocked. Contact your Administrator.' });
    }
  }

  // Simpan seluruh data user ke session
  const user = req.session.user
  req.session.user = userRow;
  res.redirect('/dashboard');
});

// Logout handler
router.get('/logout', (req, res) => {
  // Destroy session
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    // Redirect to login page
    res.redirect('/login');
  });
});

module.exports = router; 