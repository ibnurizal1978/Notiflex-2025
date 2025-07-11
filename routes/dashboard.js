const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../supabaseClient');
const { simpleMenuCheck } = require('../middleware/simpleAuth');
const { encryptId, decryptId } = require('../middleware/idCrypto');
const validator = require('validator');
const multer = require('multer');
//const upload = multer({ dest: 'uploads/' });
const upload = multer({ storage: multer.memoryStorage() });
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Set PATH environment variable to include poppler binaries
const currentPath = process.env.PATH || '';
const popplerPaths = new PDFPoppler(filePath, {
  popplerPath: popplerPath // Ini yang harus diset!
  // Anda juga bisa spesifik per utility:
  // pdftoppm: path.join(popplerPath, 'pdftoppm'),
  // pdftotext: path.join(popplerPath, 'pdftotext'),
  // ...
});
/*const popplerPaths = [
  'C:\\Users\\elzetor\\Downloads\\poppler-24.08.0\\Library\\bin',
  'C:\\Program Files\\poppler-23.11.0\\Library\\bin',
  'C:\\Program Files\\poppler-24.02.0\\Library\\bin',
  'C:\\poppler\\bin',
  path.join(process.cwd(), 'poppler', 'bin')
];*/

// Add poppler paths to PATH if they exist
const newPaths = popplerPaths.filter(p => fs.existsSync(p));
if (newPaths.length > 0) {
  process.env.PATH = newPaths.join(';') + ';' + currentPath;
  console.log('Added poppler paths to PATH:', newPaths);
} else {
  console.log('No poppler paths found. Available paths checked:', popplerPaths);
}

let PdfConverter;
try {
  PdfConverter = require('pdf-poppler').PdfConverter;
  console.log('pdf-poppler module loaded successfully');
} catch (e) {
  console.log('pdf-poppler module not available:', e.message);
  PdfConverter = null;
}

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch').default;

const SUPABASE_URL = 'https://imszplqsfatobncgafhb.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'ISI_KEY_DISINI';
const supabaseStorage = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const BUCKET_NAME = 'notiflex';

// Utilitas: Ekstrak teks dari PDF (pdf-parse), fallback ke OCR jika kosong
async function extractTextWithFallback(filePath, mimetype) {
  let text = '';
  if (mimetype === 'application/pdf') {
    // 1. Coba pdf-parse
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      text = pdfData.text?.trim() || '';
      console.log('PDF parse result length:', text.length);
    } catch (e) {
      console.log('PDF parse error:', e.message);
      text = '';
    }
    
    // 2. Jika kosong/newline, fallback ke OCR (halaman 1)
    if (!text || text.replace(/\n/g, '').length < 10) {
      console.log('Text too short, attempting OCR fallback...');
      
      if (!PdfConverter) {
        console.log('PdfConverter not available, trying direct pdftoppm...');
        // Fallback: try direct pdftoppm command
        try {
          const outputDir = path.join(__dirname, '../uploads/tmp');
          if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
          const outputImage = path.join(outputDir, 'page-1.png');
          
          // Use spawn to run pdftoppm directly
          const pdftoppm = spawn('pdftoppm', [
            '-png',
            '-singlefile',
            '-f', '1',
            '-l', '1',
            filePath,
            path.join(outputDir, 'page-1')
          ]);
          
          await new Promise((resolve, reject) => {
            pdftoppm.on('close', (code) => {
              if (code === 0) {
                console.log('pdftoppm conversion successful');
                resolve();
              } else {
                console.log('pdftoppm conversion failed with code:', code);
                reject(new Error(`pdftoppm failed with code ${code}`));
              }
            });
            
            pdftoppm.on('error', (err) => {
              console.log('pdftoppm spawn error:', err.message);
              reject(err);
            });
          });
          
          // Check if the image was created
          if (fs.existsSync(outputImage)) {
            console.log('Image created successfully, running OCR...');
            const ocrResult = await Tesseract.recognize(outputImage, 'ind');
            text = ocrResult.data.text;
            console.log('OCR result length:', text.length);
          } else {
            console.log('Image file not found after pdftoppm conversion');
            throw new Error('Failed to create image from PDF');
          }
          
          // Clean up
          if (fs.existsSync(outputImage)) fs.unlinkSync(outputImage);
          
        } catch (directError) {
          console.log('Direct pdftoppm failed:', directError.message);
          throw new Error('pdf-poppler not installed and direct pdftoppm failed. Cannot OCR PDF.');
        }
      } else {
        // Use pdf-poppler module
        try {
          const outputDir = path.join(__dirname, '../uploads/tmp');
          if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
          const outputImage = path.join(outputDir, 'page-1.png');
          
          console.log('Using pdf-poppler module for conversion...');
          await PdfConverter.convert(filePath, {
            format: 'png',
            out_dir: outputDir,
            out_prefix: 'page',
            page: 1
          });
          
          if (fs.existsSync(outputImage)) {
            console.log('Image created successfully, running OCR...');
            const ocrResult = await Tesseract.recognize(outputImage, 'ind');
            text = ocrResult.data.text;
            console.log('OCR result length:', text.length);
          } else {
            console.log('Image file not found after pdf-poppler conversion');
            throw new Error('Failed to create image from PDF');
          }
          
          // Clean up
          if (fs.existsSync(outputImage)) fs.unlinkSync(outputImage);
          
        } catch (popplerError) {
          console.log('pdf-poppler conversion failed:', popplerError.message);
          throw new Error('pdf-poppler conversion failed. Cannot OCR PDF.');
        }
      }
    }
  } else if (mimetype.startsWith('image/')) {
    console.log('Processing image file with OCR...');
    const ocrResult = await Tesseract.recognize(filePath, 'ind');
    text = ocrResult.data.text;
    console.log('Image OCR result length:', text.length);
  }
  return text;
}


// Dashboard page
router.get('/', async (req, res) => {
  const user = req.session.user;
  try {
    res.render('dashboard', { user: { email: user.email, id: user.id } });
  } catch (err) {
    if (err instanceof Error) {
      console.error('Dashboard error:', err.stack || err.message || err);
    } else {
      console.error('Dashboard error:', JSON.stringify(err));
    }
    res.status(500).send('Internal Server Error');
  }
});

/* ========== USERS =========== */
// Users page - protected with simple menu check
router.get('/users', simpleMenuCheck('/users'), async (req, res) => {
  const user = req.session.user;
  let usersPage = [];
  const perPage = 12;
  const currentPage = parseInt(req.query.page, 10) || 1;
  let totalPages = 1;
  const search = (req.query.search || '').trim();
  let userList = [];
  if (user && user.id) {
    // Ambil users dengan client_id yang sama
    let query = supabase
      .from('users')
      .select('*')
      .eq('client_id', user.client_id)
      .eq('is_deleted', false)
    if (search) {
      // Filter by name or email (case-insensitive)
      query = query.ilike('name', `%${search}%`).or(`email.ilike.%${search}%`);
    }
    const { data } = await query;
    userList = data || [];
    totalPages = Math.ceil(userList.length / perPage) || 1;
    const start = (currentPage - 1) * perPage;
    const end = Math.min(start + perPage, userList.length);
    usersPage = userList.slice(start, end);
  }
  if (!usersPage) usersPage = [];
  res.render('users', { usersPage, currentPage, perPage, totalPages, encryptId, userLoginId: req.session.user.id, search });
});

//users-create GET - protected with simple menu check
router.get('/users/create', simpleMenuCheck('/users'), async (req, res) => {
  const user = req.session.user;
  try {
    // Ambil list leaders (users dengan client_id yang sama)
    const { data: leaders } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('client_id', user.client_id);
    
    // Ambil semua menus
    const { data: allMenus } = await supabase
      .from('menus')
      .select('*');
    
    res.render('users-create', { 
      leaders: leaders || [],
      allMenus: allMenus || []
    });
  } catch (error) {
    console.error('Error fetching data for user creation:', error);
    res.status(500).send('Internal Server Error');
  }
});

//users-create POST
router.post('/users/create', async (req, res) => {
  const user = req.session.user;
  const { name, email, leader_id, password1, password2, menu_access } = req.body;
  
  try {
    // Validasi password
    if (password1 !== password2) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    
    if (password1.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    // Validasi email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Cek apakah email sudah ada
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();
    
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    // Try admin method first, fallback to regular signup if admin fails
    let authData = null;
    let authError = null;
    
    try {
      // Buat user di Supabase Auth menggunakan admin client
      const result = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: password1,
        email_confirm: true, // Auto confirm email
        user_metadata: { name: name }
      });
      authData = result.data;
      authError = result.error;
    } catch (adminError) {
      console.log('Admin method failed, trying regular signup:', adminError.message);
      
      // Fallback: use regular signup method
      const signupResult = await supabase.auth.signUp({
        email: email,
        password: password1,
        options: {
          data: { name: name }
        }
      });
      authData = signupResult.data;
      authError = signupResult.error;
      
      if (!authError && authData.user) {
        // For regular signup, we need to manually confirm the email
        // This is a limitation - the user will need to confirm their email
        console.log('User created via regular signup - email confirmation required');
      }
    }
    
    if (authError) {
      console.error('Supabase auth error:', authError);
      return res.status(400).json({ error: 'Failed to create user account: ' + authError.message });
    }
    
    if (!authData || !authData.user) {
      return res.status(400).json({ error: 'No user data returned from auth creation' });
    }
    
    // Simpan ke table users
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert({
        user_uuid: authData.user.id,
        name: name,
        email: email,
        client_id: user.client_id,
        leader_id: leader_id || null,
        is_active: true
      })
      .select()
      .single();
    
    if (userError) {
      console.error('Database insert error:', userError);
      // Rollback: hapus user dari auth jika gagal insert ke database
      try {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      } catch (deleteError) {
        console.error('Failed to delete auth user during rollback:', deleteError);
      }
      return res.status(400).json({ error: 'Failed to save user data' });
    }
    
    // Simpan menu access jika ada
    if (menu_access && menu_access.length > 0) {
      const menuUserData = menu_access.map(menuId => ({
        user_id: userData.id,
        menu_id: parseInt(menuId)
      }));
      
      const { error: menuError } = await supabase
        .from('menu_user')
        .insert(menuUserData);
      
      if (menuError) {
        console.error('Menu access insert error:', menuError);
        // Note: tidak rollback karena user sudah dibuat
      }
    }

    // Insert audit_log
    const { error: auditError } = await supabase.from('audit_log').insert([{
      user_id: user.id,
      client_id: user.client_id,
      action: 'Create',
      pages: 'Users',
      created_at: new Date().toISOString(),
      notes: `Create a user ${name}`
    }]);
    
    res.json({ 
      success: true, 
      message: 'User created successfully',
      note: authData.user.email_confirmed_at ? 'User is ready to login' : 'User needs to confirm email'
    });
    
  } catch (error) {
    console.error('User creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

//users-edit GET
router.get('/users/edit/:encId', simpleMenuCheck('/users'), async (req, res) => {
  const user = req.session.user;
  const userId = decryptId(req.params.encId);
  if (!userId) {
    req.session.errorMessage = 'Invalid user ID.';
    return res.redirect('/dashboard/users');
  }
  
  try {
    // Ambil data user yang akan diedit
    const { data: editUser, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .eq('client_id', user.client_id) // Pastikan user dari client yang sama
      .single();
    
    if (userError || !editUser) {
      req.session.errorMessage = 'User not found or you do not have permission to edit this user.';
      return res.redirect('/dashboard/users');
    }
    
    // Ambil list leaders (users dengan client_id yang sama, kecuali user yang sedang diedit)
    const { data: leaders } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('client_id', user.client_id)
      .neq('id', userId); // Exclude current user
    
    // Ambil semua menus
    const { data: allMenus } = await supabase
      .from('menus')
      .select('*');
    
    // Ambil menu access user yang sedang diedit
    const { data: userMenus } = await supabase
      .from('menu_user')
      .select('menu_id')
      .eq('user_id', userId);
    
    const userMenuIds = userMenus ? userMenus.map(mu => mu.menu_id) : [];
    
    res.render('users-edit', { 
      editUser,
      leaders: leaders || [],
      allMenus: allMenus || [],
      userMenuIds: userMenuIds,
      encId: req.params.encId
    });
  } catch (error) {
    console.error('Error fetching data for user edit:', error);
    req.session.errorMessage = 'Error loading user data.';
    res.redirect('/dashboard/users');
  }
});

//users-edit POST
router.post('/users/edit/:encId', simpleMenuCheck('/users'), async (req, res) => {
  const user = req.session.user;
  const userId = decryptId(req.params.encId);
  if (!userId) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }
  // Escape hanya string, bukan seluruh req.body
  const name = validator.escape(req.body.name || '');
  const email = validator.escape(req.body.email || '');
  const leader_id = validator.escape(req.body.leader_id || '');
  const menu_access = req.body.menu_access;
  const password1 = req.body.password1;
  const password2 = req.body.password2;

  try {
    // Validasi user exists dan punya permission
    const { data: editUser, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .eq('client_id', user.client_id)
      .single();
    
    if (userError || !editUser) {
      return res.status(400).json({ error: 'User not found or you do not have permission to edit this user.' });
    }
    
    // Validasi email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Cek apakah email sudah ada (kecuali user yang sedang diedit)
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .neq('id', userId)
      .single();
    
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    // Konversi is_active ke boolean (support 'TRUE'/'FALSE' string dari form)
    let is_active_bool = true;
    if (typeof req.body.is_active === 'string') {
      is_active_bool = req.body.is_active.toLowerCase() === 'true';
    }
    
    // Update user data
    const updateData = {
      name: name,
      email: email,
      is_active: is_active_bool,
      leader_id: leader_id || null
    };
    
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();
    
    if (updateError) {
      console.error('Database update error:', updateError);
      return res.status(400).json({ error: 'Failed to update user data' });
    }
    
    // Update password jika diisi
    if (password1 && password2) {
      if (password1 !== password2) {
        return res.status(400).json({ error: 'Passwords do not match' });
      }
      
      if (password1.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      
      // Update password di Supabase Auth
      try {
        const { error: passwordError } = await supabaseAdmin.auth.admin.updateUserById(
          editUser.user_uuid,
          { password: password1 }
        );
        
        if (passwordError) {
          console.error('Password update error:', passwordError);
          // Note: tidak return error karena data user sudah diupdate
        }
      } catch (authError) {
        console.error('Auth password update error:', authError);
      }
    }
    
    // Update menu access
    if (menu_access) {
      // Hapus menu access lama
      await supabase
        .from('menu_user')
        .delete()
        .eq('user_id', userId);
      
      // Insert menu access baru
      if (menu_access.length > 0) {
        const menuUserData = menu_access.map(menuId => ({
          user_id: userId,
          menu_id: parseInt(menuId)
        }));
        
        const { error: menuError } = await supabase
          .from('menu_user')
          .insert(menuUserData);
        
        if (menuError) {
          console.error('Menu access update error:', menuError);
        }
      }
    }
    
    res.json({ 
      success: true, 
      message: 'User updated successfully'
    });

    // Insert audit_log
    const { error: auditError } = await supabase.from('audit_log').insert([{
      user_id: user.id,
      client_id: user.client_id,
      action: 'Edit',
      pages: 'Users',
      created_at: new Date().toISOString(),
      notes: `Edit a user ID ${userId}`
    }]);
    
  } catch (error) {
    console.error('User update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Soft delete user
router.post('/users/delete/:encId', simpleMenuCheck('/users'), async (req, res) => {
  const user = req.session.user;
  const userId = decryptId(req.params.encId);
  if (!userId) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }
  if (userId == user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }
  try {
    const { error } = await supabase
      .from('users')
      .update({ is_deleted: true })
      .eq('id', userId)
      .eq('client_id', user.client_id);
    if (error) {
      return res.status(400).json({ error: 'Failed to delete user.' });
    }

    // Insert audit_log
    const { error: auditError } = await supabase.from('audit_log').insert([{
      user_id: user.id,
      client_id: user.client_id,
      action: 'Delete',
      pages: 'Users',
      created_at: new Date().toISOString(),
      notes: `Delete a user ID ${userId}`
    }]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ========= GROUPS ======== */
/* get groups page */
router.get('/groups', simpleMenuCheck('/groups'), async (req, res) => {
  const user = req.session.user;
  const perPage = 15;
  const currentPage = parseInt(req.query.page, 10) || 1;
  const search = (req.query.search || '').trim();
  let groupsList = [];
  let totalPages = 1;
  let usersInClient = [];

  if (user && user.id) {
    // Query groups milik client
    let query = supabase
      .from('groups')
      .select('*')
      .eq('client_id', user.client_id)
      .eq('is_deleted', false)
    if (search) {
      query = query.ilike('name', `%${search}%`);
    }
    const { data: groupsData } = await query;
    groupsList = groupsData || [];

    // Ambil semua group_detail untuk group yang tampil
    const groupIds = groupsList.map(g => g.id);
    let groupDetails = [];
    if (groupIds.length > 0) {
      const { data: gd } = await supabase
        .from('group_detail')
        .select('group_id, user_id')
        .in('group_id', groupIds);
      groupDetails = gd || [];
    }

    // Ambil semua user yang id-nya ada di group_detail
    const userIds = [...new Set(groupDetails.map(gd => gd.user_id))];
    let usersMap = {};
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, name, email')
        .in('id', userIds)
        .eq('is_deleted', false);
      (users || []).forEach(u => {
        usersMap[u.id] = u;
      });
    }

    // Hitung jumlah member dan kumpulkan nama member per group
    const memberCountMap = {};
    const memberNamesMap = {};
    (groupDetails || []).forEach(gd => {
      memberCountMap[gd.group_id] = (memberCountMap[gd.group_id] || 0) + 1;
      if (!memberNamesMap[gd.group_id]) {
        memberNamesMap[gd.group_id] = [];
      }
      if (usersMap[gd.user_id]) {
        memberNamesMap[gd.group_id].push(usersMap[gd.user_id].name);
      }
    });

    // Tambahkan count dan member names ke setiap group
    groupsList = groupsList.map(g => ({
      ...g,
      memberCount: memberCountMap[g.id] || 0,
      memberNames: memberNamesMap[g.id] || []
    }));

    // Ambil semua user pembuat group
    const creatorIds = [...new Set(groupsList.map(g => g.created_by).filter(Boolean))];
    let creatorsMap = {};
    if (creatorIds.length > 0) {
      const { data: creators } = await supabase
        .from('users')
        .select('id, name, email')
        .in('id', creatorIds);
      (creators || []).forEach(u => {
        creatorsMap[u.id] = u;
      });
    }
    // Tambahkan info pembuat dan tanggal ke setiap group
    groupsList = groupsList.map(g => ({
      ...g,
      memberCount: memberCountMap[g.id] || 0,
      memberNames: memberNamesMap[g.id] || [],
      creatorName: creatorsMap[g.created_by]?.name || '-',
      createdAt: g.created_at
    }));

    totalPages = Math.ceil(groupsList.length / perPage) || 1;
    const start = (currentPage - 1) * perPage;
    const end = Math.min(start + perPage, groupsList.length);
    groupsList = groupsList.slice(start, end);

    // Ambil usersInClient untuk modal (agar tidak error di EJS)
    const { data: users } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('client_id', user.client_id)
      .eq('is_deleted', false);
    usersInClient = users || [];
  }
  res.render('groups', { groupsPage: groupsList, currentPage, perPage, totalPages, encryptId, userLoginId: req.session.user.id, search, usersInClient });
});

// GET data users untuk modal create group
router.get('/groups/create', simpleMenuCheck('/groups'), async (req, res) => {
  const user = req.session.user;
  let usersList = [];
  let reminderList = [];
  if (user && user.client_id) {
    // Ambil semua user dalam client
    const { data: users } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('client_id', user.client_id)
      .eq('is_deleted', false);
    usersList = users || [];
    // Ambil semua object_type_reminder untuk client ini, join ke object_type untuk ambil nama type
    const { data: reminders, error: reminderErr } = await supabase
      .from('object_type')
      .select('id, name')
      .eq('is_active', true);
    reminderList = (reminders || []).map(r => ({
      id: r.id,
      object_name: r.name
    }));
    if (reminderErr) {
      console.error('Error fetching reminders:', reminderErr);
    }
    if (!reminderList.length) {
      res.render('groups-create', { ...res.locals, usersList, reminderList, reminderError: 'Tidak ada data reminder ditemukan untuk client ini.' });
      return;
    }
  }
  res.render('groups-create', { ...res.locals, usersList, reminderList });
});

// POST create group
router.post('/groups/create', simpleMenuCheck('/groups'), async (req, res) => {
  const user = req.session.user;
  // Support both JSON and form POSTs
  const body = req.is('application/json') ? req.body : req.body;
  console.log('DEBUG group create body:', body);
  const group_name = body.group_name || body.name;
  let members = body.members;
  if (!Array.isArray(members)) {
    if (members) members = [members];
    else members = [];
  }
  if (!group_name || !user) {
    return res.status(400).json({ success: false, error: 'Missing group name or user session.' });
  }
  // Insert group
  const { data: group, error: groupErr } = await supabase
    .from('groups')
    .insert([{ 
      name: group_name, 
      client_id: user.client_id,
      created_by: user.id,
      created_at: new Date().toISOString()
    }])
    .select()
    .single();
  if (groupErr || !group) {
    return res.status(400).json({ success: false, error: groupErr ? groupErr.message : 'Failed to create group.' });
  }
  // Insert group_detail
  if (members.length > 0) {
    const groupDetails = members.map(uid => ({ group_id: group.id, user_id: uid }));
    const { error: groupDetailErr } = await supabase.from('group_detail').insert(groupDetails);
    if (groupDetailErr) {
      return res.status(400).json({ success: false, error: groupDetailErr.message });
    }
  }
  // Insert reminder period per group
  let reminders = body.reminders;
  let remind_in = body.remind_in;
  if (reminders && remind_in) {
    if (!Array.isArray(reminders)) reminders = [reminders];
    for (let i = 0; i < reminders.length; i++) {
      const object_type_id = reminders[i];
      // Ambil remind_in dari field unik
      const remindValue = parseInt(body['remind_in_' + object_type_id], 10) || 1;
      const { error: reminderInsertErr } = await supabase
        .from('object_type_reminder')
        .insert({
          object_type_id: object_type_id,
          client_id: user.client_id,
          created_by: user.id,
          remind_in: remindValue,
          remind_using: 'EMAIL',
          group_id: group.id
        });
      if (reminderInsertErr) {
        return res.status(400).json({ success: false, error: reminderInsertErr.message });
      }
    }
  }
  // Insert audit_log
  const { error: auditError } = await supabase.from('audit_log').insert([{
    user_id: user.id,
    client_id: user.client_id,
    action: 'Create',
    pages: 'Groups',
    created_at: new Date().toISOString(),
    notes: `Create a group ${group_name}`
  }]);
  if (auditError) {
    console.error('Audit log insert error:', auditError);
    // Tidak return error ke user, hanya log
  }
  return res.json({ success: true });
});

// GET edit group (halaman)
router.get('/groups/edit/:id', simpleMenuCheck('/groups'), async (req, res) => {
  const user = req.session.user;
  const groupId = req.params.id;
  let group = null;
  let members = [];
  let usersList = [];
  let reminderList = [];
  let reminders = [];
  if (user && user.client_id) {
    // Ambil data group
    const { data: groupData } = await supabase
      .from('groups')
      .select('*')
      .eq('id', groupId)
      .eq('client_id', user.client_id)
      .single();
    group = groupData;
    // Ambil member group
    const { data: groupMembers } = await supabase
      .from('group_detail')
      .select('user_id')
      .eq('group_id', groupId);
    members = (groupMembers || []).map(m => m.user_id);
    // Ambil semua user dalam client
    const { data: users } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('client_id', user.client_id)
      .eq('is_deleted', false);
    usersList = users || [];
    // Ambil semua object_type_reminder untuk group ini
    const { data: remindersData } = await supabase
      .from('object_type_reminder')
      .select('id, object_type_id, remind_in, group_id, object_type(name)')
      .eq('group_id', groupId)
      .eq('client_id', user.client_id);
    reminders = (remindersData || []).map(r => r.object_type_id);
    // Ambil semua object_type untuk client ini
    const { data: objectTypes } = await supabase
      .from('object_type')
      .select('id, name')
      .eq('is_active', true);
    reminderList = (objectTypes || []).map(obj => {
      // Cari reminder period yang sudah ada untuk group ini
      const found = (remindersData || []).find(r => r.object_type_id === obj.id);
      return {
        id: obj.id,
        object_name: obj.name,
        remind_in: found ? found.remind_in : 1 // default 1 jika belum ada
      };
    });
  }
  res.render('groups-edit', { group, usersList, members, reminderList, reminders });
});

// POST update group
router.post('/groups/edit/:id', simpleMenuCheck('/groups'), async (req, res) => {
  const user = req.session.user;
  const groupId = req.params.id;
  const { name } = req.body;
  let members = req.body.members;
  let reminders = req.body.reminders;
  
  if (!Array.isArray(members)) {
    if (members) members = [members];
    else members = [];
  }
  
  if (!Array.isArray(reminders)) {
    if (reminders) reminders = [reminders];
    else reminders = [];
  }
  
  if (!name || !user) {
    return res.redirect('/dashboard/groups');
  }
  
  try {
    // Update group name
    const { error: groupErr } = await supabase
      .from('groups')
      .update({ name: name })
      .eq('id', groupId)
      .eq('client_id', user.client_id);
    if (groupErr) {
      console.error('Group update error:', groupErr);
      return res.redirect('/dashboard/groups');
    }
    
    // Update group_detail: hapus semua, insert baru
    await supabase.from('group_detail').delete().eq('group_id', groupId);
    if (members.length > 0) {
      const groupDetails = members.map(uid => ({ group_id: groupId, user_id: uid }));
      await supabase.from('group_detail').insert(groupDetails);
    }
    
    // Update object_type_reminder: hapus semua yang ada untuk group ini, insert baru
    await supabase.from('object_type_reminder').delete().eq('group_id', groupId);
    
    if (reminders.length > 0) {
      const reminderData = reminders.map(reminderId => {
        const remindIn = req.body[`remind_in_${reminderId}`] || 1;
        return {
          object_type_id: parseInt(reminderId),
          group_id: groupId,
          client_id: user.client_id,
          remind_in: parseInt(remindIn),
          remind_using: 'EMAIL'
        };
      });
      
      const { error: reminderErr } = await supabase
        .from('object_type_reminder')
        .insert(reminderData);
      
      if (reminderErr) {
        console.error('Reminder insert error:', reminderErr);
      }
    }
    
    // Insert audit_log
    const { error: auditError } = await supabase.from('audit_log').insert([{
      user_id: user.id,
      client_id: user.client_id,
      action: 'Edit',
      pages: 'Groups',
      created_at: new Date().toISOString(),
      notes: `Edit group ${name}`
    }]);
    if (auditError) {
      console.error('Audit log insert error:', auditError);
    }
    
    res.redirect('/dashboard/groups');
  } catch (error) {
    console.error('Error updating group:', error);
    res.redirect('/dashboard/groups');
  }
});

// POST delete group (soft delete)
router.post('/groups/delete/:id', simpleMenuCheck('/groups'), async (req, res) => {
  const user = req.session.user;
  const groupId = req.params.id;
  if (!user) return res.redirect('/dashboard/groups');
  // Ambil nama group untuk audit log
  const { data: groupData } = await supabase
    .from('groups')
    .select('name')
    .eq('id', groupId)
    .eq('client_id', user.client_id)
    .single();
  // Soft delete
  const { error: delErr } = await supabase
    .from('groups')
    .update({ is_deleted: true })
    .eq('id', groupId)
    .eq('client_id', user.client_id);
  // Audit log
  const { error: auditError } = await supabase.from('audit_log').insert([{
    user_id: user.id,
    client_id: user.client_id,
    action: 'Delete',
    pages: 'Groups',
    created_at: new Date().toISOString(),
    notes: `Delete group ${groupData ? groupData.name : groupId}`
  }]);
  if (delErr) console.error('Delete group error:', delErr);
  if (auditError) console.error('Audit log insert error:', auditError);
  res.redirect('/dashboard/groups');
});

/* ===== NOTIFICATIONS ===== */
router.get('/notifications', simpleMenuCheck('/notifications'), async (req, res) => {
  const user = req.session.user;
  const perPage = 10;
  const currentPage = parseInt(req.query.page, 10) || 1;
  const search = (req.query.search || '').trim();
  let notificationsList = [];
  let totalPages = 1;
  let allGroups = [];

  if (user && user.id) {
    // 1. Ambil semua object_type_reminder untuk client ini, join ke object_type untuk ambil nama
    let reminderQuery = supabase
      .from('object_type_reminder')
      .select('*, object_type(name)')
      .eq('client_id', user.client_id)
      .eq('is_deleted', false);
    if (search) {
      reminderQuery = reminderQuery.ilike('remind_using', `%${search}%`);
    }
    const { data: remindersData } = await reminderQuery;
    notificationsList = remindersData || [];

    // 2. Ambil semua group yang memiliki object_type_reminder
    const groupIds = [...new Set(notificationsList.map(r => r.group_id))];
    let groupsMap = {};
    if (groupIds.length > 0) {
      const { data: groups } = await supabase
        .from('groups')
        .select('id, name')
        .in('id', groupIds);
      groupsMap = (groups || []).reduce((map, g) => ({ ...map, [g.id]: g }), {});
    }

    // 3. Ambil semua user yang terkait dengan object_type_reminder
    const groupIdList = [...new Set(notificationsList.map(r => r.group_id).filter(Boolean).map(String))];
    let groupUsersMap = {};
    if (groupIdList.length > 0) {
      // Ambil semua group_detail untuk group-group terkait
      const { data: groupDetails } = await supabase
        .from('group_detail')
        .select('group_id, user_id');
      const allUserIds = [...new Set((groupDetails || []).map(gd => gd.user_id))];
      let usersMap = {};
      if (allUserIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, name')
          .in('id', allUserIds)
          .eq('is_deleted', false);
        usersMap = (users || []).reduce((map, u) => ({ ...map, [u.id]: u.name }), {});
      }
      // Map group_id ke array nama user, pakai string agar konsisten
      groupUsersMap = (groupDetails || []).reduce((map, gd) => {
        const gid = String(gd.group_id);
        if (!map[gid]) map[gid] = [];
        if (usersMap[gd.user_id]) map[gid].push(usersMap[gd.user_id]);
        return map;
      }, {});
    }

    // 4. Gabungkan semua informasi
    notificationsList = notificationsList.map(r => ({
      ...r,
      objectTypeName: r.object_type?.name || '-',
      groupName: groupsMap[r.group_id]?.name || '-',
      userNames: groupUsersMap[String(r.group_id)] || [],
    }));

    totalPages = Math.ceil(notificationsList.length / perPage) || 1;
    const start = (currentPage - 1) * perPage;
    const end = Math.min(start + perPage, notificationsList.length);
    notificationsList = notificationsList.slice(start, end);
  }
  res.render('notifications', { notificationsPage: notificationsList, currentPage, perPage, totalPages, encryptId, userLoginId: req.session.user.id, search, allGroups });
});

// GET create notification
router.get('/notifications/create', simpleMenuCheck('/notifications'), async (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect('/login');
  // Ambil object_type
  const { data: objectTypes } = await supabase
    .from('object_type')
    .select('id, name')
    .eq('is_active', true);
  // Ambil groups
  const { data: groups } = await supabase
    .from('groups')
    .select('id, name')
    .eq('client_id', user.client_id)
    .eq('is_deleted', false);
  res.render('notifications-create', { objectTypes: objectTypes || [], groups: groups || [] });
});

// POST create notification
router.post('/notifications/create', simpleMenuCheck('/notifications'), async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { notifications } = req.body;
  if (!Array.isArray(notifications) || notifications.length === 0) {
    return res.status(400).json({ success: false, error: 'No notifications to create.' });
  }
  const rows = notifications.map(n => ({
    object_type_id: n.object_type_id,
    remind_in: n.remind_in,
    remind_using: n.remind_using,
    group_id: n.group_id,
    client_id: user.client_id,
    created_by: user.id
  }));
  const { error } = await supabase.from('object_type_reminder').insert(rows);
  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  res.json({ success: true });
});

// POST soft delete notification (object_type_reminder)
router.post('/notifications/delete/:id', simpleMenuCheck('/notifications'), async (req, res) => {
  const user = req.session.user;
  const id = req.params.id;
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { error } = await supabase
    .from('object_type_reminder')
    .update({ is_deleted: true })
    .eq('id', id);
  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  res.json({ success: true });
});



/* ========== OBJECTS ============ */
// GET objects page
router.get('/objects', simpleMenuCheck('/objects'), async (req, res) => {
  const user = req.session.user;
  const perPage = 15;
  const currentPage = parseInt(req.query.page, 10) || 1;
  const search = (req.query.search || '').trim();
  let totalPages = 1;
  if (!user) return res.redirect('/login');
  // Query builder
  let query = supabase
    .from('objects')
    .select('id, name, location, notes, object_type_id, object_type(name)', { count: 'exact' })
    .eq('client_id', user.client_id)
    .eq('is_deleted', false)
  if (search) {
    query = query.ilike('name', `%${search}%`);
  }
  // Paging
  const from = (currentPage - 1) * perPage;
  const to = from + perPage - 1;
  query = query.range(from, to);
  const { data: objects, count } = await query;
  totalPages = Math.ceil((count || 0) / perPage) || 1;
  // Ambil semua object_type
  const { data: objectTypes } = await supabase
    .from('object_type')
    .select('id, name')
    .eq('is_active', true)
    .eq('is_deleted', false)
  res.render('objects', {
    objects: objects || [],
    objectTypes: objectTypes || [],
    encryptId,
    currentPage,
    perPage,
    totalPages,
    search
  });
});

// POST create object
router.post('/objects', simpleMenuCheck('/objects'), async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { name, location, notes, object_type_id } = req.body;
  if (!name || !object_type_id) {
    return res.status(400).json({ success: false, error: 'Name and object type are required.' });
  }
  const { error } = await supabase
    .from('objects')
    .insert({
      name,
      location,
      notes,
      object_type_id,
      client_id: user.client_id,
      created_by: user.id
    });
  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  res.json({ success: true });
});

// GET create object page
router.get('/objects/create', simpleMenuCheck('/objects'), async (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect('/login');
  const { data: objectTypes } = await supabase
    .from('object_type')
    .select('id, name')
    .eq('is_active', true);
  res.render('objects-create', { objectTypes: objectTypes || [] });
});

// GET edit object page
router.get('/objects/edit/:id', simpleMenuCheck('/objects'), async (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect('/login');
  const encId = req.params.id;
  const objectId = decryptId(encId);
  if (!objectId) return res.redirect('/dashboard/objects');
  // Ambil data object
  const { data: object, error: objectError } = await supabase
    .from('objects')
    .select('*')
    .eq('id', objectId)
    .eq('client_id', user.client_id)
    .single();
  if (objectError || !object) {
    return res.redirect('/dashboard/objects');
  }
  // Ambil semua object_type
  const { data: objectTypes } = await supabase
    .from('object_type')
    .select('id, name')
    .eq('is_active', true);
  res.render('objects-edit', { object, objectTypes: objectTypes || [], encryptId });
});

// UPDATE object (PUT)
router.put('/objects/edit/:id', simpleMenuCheck('/objects'), async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const encId = req.params.id;
  const objectId = decryptId(encId);
  if (!objectId) return res.status(400).json({ success: false, error: 'Invalid object ID' });
  const { name, location, notes, object_type_id } = req.body;
  if (!name || !object_type_id) {
    return res.status(400).json({ success: false, error: 'Name and object type are required.' });
  }
  const { error } = await supabase
    .from('objects')
    .update({
      name,
      location,
      notes,
      object_type_id
    })
    .eq('id', objectId)
    .eq('client_id', user.client_id);
  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  res.json({ success: true });
});

// POST soft delete object
router.post('/objects/delete/:id', simpleMenuCheck('/objects'), async (req, res) => {
  const user = req.session.user;
  const encId = req.params.id;
  const objectId = decryptId(encId);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  if (!objectId) return res.status(400).json({ success: false, error: 'Invalid object ID' });
  
  // Ambil nama object untuk audit log
  const { data: objectData } = await supabase
    .from('objects')
    .select('name')
    .eq('id', objectId)
    .eq('client_id', user.client_id)
    .single();
  
  // Soft delete
  const { error: delErr } = await supabase
    .from('objects')
    .update({ is_deleted: true })
    .eq('id', objectId)
    .eq('client_id', user.client_id);
  
  if (delErr) {
    console.error('Delete object error:', delErr);
    return res.status(400).json({ success: false, error: 'Failed to delete object' });
  }
  
  // Audit log
  const { error: auditError } = await supabase.from('audit_log').insert([{
    user_id: user.id,
    client_id: user.client_id,
    action: 'Delete',
    pages: 'Objects',
    created_at: new Date().toISOString(),
    notes: `Delete object ${objectData ? objectData.name : objectId}`
  }]);
  
  if (auditError) {
    console.error('Audit log insert error:', auditError);
  }
  
  res.json({ success: true });
});

// GET add item page
router.get('/items/add/:objectId', simpleMenuCheck('/objects'), async (req, res) => {
  const object_id = req.params.objectId;
  res.render('items-add', { object_id });
});

// POST add item
router.post('/items/add', simpleMenuCheck('/objects'), upload.single('file'), async (req, res) => {
  const user = req.session.user;
  const { object_id, name, location, notes, title, end_date } = req.body;
  const file = req.file;
  if (!user || !object_id || !name || !file) {
    return res.status(400).json({ success: false, error: 'Missing required fields.' });
  }
  // 1. Upload file ke Supabase Storage
  const fileExt = file.originalname.split('.').pop();
  const filePath = `items/${Date.now()}_${file.originalname}`;
  const { data: uploadData, error: uploadError } = await supabaseStorage.storage.from(BUCKET_NAME).upload(filePath, fs.createReadStream(file.path), {
    contentType: file.mimetype,
    upsert: true
  });
  if (uploadError) {
    return res.status(400).json({ success: false, error: 'Failed to upload file to storage.' });
  }
  const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${filePath}`;
  // 2. Ekstrak text dari file (dengan fallback OCR)
  let extractedText = '';
  try {
    extractedText = await extractTextWithFallback(file.path, file.mimetype);
  } catch (err) {
    extractedText = '';
    console.log('extractTextWithFallback error:', err);
  }
  // 3. AI Title & End Date (pakai heuristik, bukan HuggingFace)
  let aiTitle = title || name;
  let aiEndDate = end_date || null;
  if (extractedText) {
    // --- Heuristik judul & tanggal ---
    const lines = extractedText.split(/\n|\r|[.!?]/).map(l => l.trim()).filter(Boolean);
    const titleKeywords = ['judul', 'kontrak', 'perjanjian', 'agreement', 'title', 'dokumen'];
    const foundTitle = lines.find(line =>
      titleKeywords.some(keyword => line.toLowerCase().includes(keyword))
    );
    const capsLine = lines.find(l => /^[A-Z0-9 .,-]+$/.test(l) && l.length > 8);
    const nonEmptyLines = lines.filter(l => l.length > 10);
    const notDateOrNumber = lines.find(l => !/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(l) && !/^\d+$/.test(l) && l.length > 5);
    if (foundTitle) {
      aiTitle = foundTitle;
    } else if (capsLine) {
      aiTitle = capsLine;
    } else if (notDateOrNumber) {
      aiTitle = notDateOrNumber;
    } else if (nonEmptyLines.length > 0) {
      aiTitle = nonEmptyLines[0];
    } else {
      aiTitle = lines.slice(0, 2).join(' / ').substring(0, 120);
    }
    // Cari tanggal (format: dd-mm-yyyy, yyyy-mm-dd, dd/mm/yyyy, dll)
    const monthNames = '(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|january|february|march|april|may|june|july|august|september|october|november|december)';
    const dateRegex = new RegExp(`\\b(\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4}|\\d{4}[\\/-]\\d{1,2}[\\/-]\\d{1,2}|\\d{1,2}[. ]${monthNames}[. ]\\d{2,4})\\b`, 'gi');
    const endDateKeywords = [
      'berakhir', 'berakhir pada tanggal', 'berakhir pada', 'sampai', 'hingga', 'selesai', 'end', 'valid until', 'berlaku sampai', 'berlaku hingga', 'masa berlaku', 'tanggal akhir', 'expiry', 'exp', 's.d.', 'sd', 's.d', 's/d', 'sampai dengan', 'sampai tanggal', 'hingga tanggal', 'berakhir tanggal', 'berlaku sampai dengan', 'berlaku s.d.', 'sampai tgl', 'valid s/d', 'sampai berakhir', 'berlaku s/d', 'sampai dan termasuk', 'sampai dan dengan', 'sampai waktu', 'sampai waktu tertentu', 'sampai waktu yang ditentukan'
    ];
    let aiEndDate = end_date || null;
    let foundDates = extractedText.match(dateRegex);
    let endDateLine = null;
    if (extractedText) {
      const lines = extractedText.split(/\n|\r|[.!?]/).map(l => l.trim()).filter(Boolean);
      // 1. Cari baris dengan dua tanggal dan penghubung (periode)
      for (const line of lines) {
        const lower = line.toLowerCase();
        const hasConnector = endDateKeywords.some(keyword => lower.includes(keyword));
        const datesInLine = line.match(dateRegex);
        if (datesInLine && datesInLine.length >= 2 && hasConnector) {
          console.log('DEBUG: Periode line with 2 dates:', line, 'Dates:', datesInLine);
          aiEndDate = datesInLine[1]; // tanggal kedua = end date
          break;
        }
      }
      // 2. Jika belum ketemu, cari baris dengan keyword end-date dan tanggal setelahnya
      if (!aiEndDate) {
        for (const line of lines) {
          const lower = line.toLowerCase();
          if (endDateKeywords.some(keyword => lower.includes(keyword)) && dateRegex.test(line)) {
            const datesInLine = line.match(dateRegex);
            if (datesInLine && datesInLine.length > 0) {
              console.log('DEBUG: End date line found:', line, 'Date(s):', datesInLine);
              aiEndDate = datesInLine[datesInLine.length-1]; // tanggal terakhir di baris
              break;
            }
          }
        }
      }
      // 3. Jika belum ketemu, cari baris dengan dua tanggal (tanpa keyword), ambil tanggal kedua
      if (!aiEndDate) {
        for (const line of lines) {
          const datesInLine = line.match(dateRegex);
          if (datesInLine && datesInLine.length >= 2) {
            console.log('DEBUG: Line with 2 dates (no keyword):', line, 'Dates:', datesInLine);
            aiEndDate = datesInLine[1];
            break;
          }
        }
      }
      // 4. Jika belum ketemu, fallback ke tanggal pertama di dokumen
      if (!aiEndDate && foundDates && foundDates.length > 0) {
        lines.forEach(line => {
          if (dateRegex.test(line)) {
            console.log('DEBUG: Line with date:', line);
          }
        });
        aiEndDate = foundDates[0];
      }
      if (!aiEndDate) {
        console.log('DEBUG: No end date found in extracted text.');
      }
    }
  }
  // 4. Insert ke table items
  const { data: item, error: itemError } = await supabase
    .from('items')
    .insert({
      object_id,
      client_id: user.client_id,
      name,
      created_by: user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      location,
      notes
    })
    .select()
    .single();
  if (itemError) {
    return res.status(400).json({ success: false, error: itemError.message });
  }
  // 5. Insert ke table item_detail
  const { error: detailError } = await supabase
    .from('item_detail')
    .insert({
      created_at: new Date().toISOString(),
      name: aiTitle,
      file_type: file.mimetype,
      file_size: file.size,
      file_url: fileUrl,
      end_date: aiEndDate,
      item_id: item.id,
      client_id: user.client_id,
      created_by: user.id
    });
  if (detailError) {
    return res.status(400).json({ success: false, error: detailError.message });
  }
  res.json({ success: true });
});

// AI extract endpoint for Add Item (AJAX)
router.post('/items/ai-extract', simpleMenuCheck('/objects'), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ success: false, error: 'No file uploaded.' });
  let extractedText = '';
  try {
    extractedText = await extractTextWithFallback(file.path, file.mimetype);
    // AI Title & End Date dengan strategi gabungan
    let aiTitle = '';
    let aiEndDate = '';
    // Cari tanggal (format: dd-mm-yyyy, yyyy-mm-dd, dd/mm/yyyy, dll)
    const dateRegex = /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2})\b/g;
    // Improved: cari baris dengan kata kunci end-date
    const endDateKeywords = [
      'berakhir', 'berakhir pada tanggal', 'sampai', 'hingga', 'selesai', 'end', 'valid until', 'berlaku sampai', 'berlaku hingga', 'masa berlaku', 'tanggal akhir', 'expiry', 'exp', 'berakhir pada', 's.d.', 'sd', 's.d', 'sampai dengan', 'sampai tanggal', 'hingga tanggal', 'berakhir tanggal', 'berlaku sampai dengan', 'berlaku s.d.'
    ];
    let foundDates = extractedText.match(dateRegex);
    let endDateLine = null;
    if (extractedText) {
      const lines = extractedText.split(/\n|\r|[.!?]/).map(l => l.trim()).filter(Boolean);
      endDateLine = lines.find(line =>
        endDateKeywords.some(keyword => line.toLowerCase().includes(keyword)) && dateRegex.test(line)
      );
      if (endDateLine) {
        // Extract date from the matched line
        const dateInLine = endDateLine.match(dateRegex);
        if (dateInLine && dateInLine.length > 0) {
          aiEndDate = dateInLine[0];
        }
      } else if (foundDates && foundDates.length > 0) {
        aiEndDate = foundDates[0];
      }
    }
    const lines = extractedText.split(/\n|\r|[.!?]/).map(l => l.trim()).filter(Boolean);
    const titleKeywords = ['judul', 'kontrak', 'perjanjian', 'agreement', 'title', 'dokumen'];
    const foundTitle = lines.find(line =>
      titleKeywords.some(keyword => line.toLowerCase().includes(keyword))
    );
    const capsLine = lines.find(l => /^[A-Z0-9 .,-]+$/.test(l) && l.length > 8);
    const nonEmptyLines = lines.filter(l => l.length > 10);
    const notDateOrNumber = lines.find(l => !/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(l) && !/^\d+$/.test(l) && l.length > 5);
    if (foundTitle) {
      aiTitle = foundTitle;
    } else if (capsLine) {
      aiTitle = capsLine;
    } else if (notDateOrNumber) {
      aiTitle = notDateOrNumber;
    } else if (nonEmptyLines.length > 0) {
      aiTitle = nonEmptyLines[0];
    } else {
      aiTitle = lines.slice(0, 2).join(' / ').substring(0, 120);
    }
    console.log('Extracted for AI:', { aiTitle, aiEndDate, extractedText: extractedText?.slice(0, 200) });
    return res.json({ success: true, title: aiTitle, end_date: aiEndDate });
  } catch (err) {
    console.log('AI extract error:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;