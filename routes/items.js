const express = require('express');
const router = express.Router();
const { supabase } = require('../supabaseClient');
const { simpleMenuCheck } = require('../middleware/simpleAuth');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BUCKET_NAME = process.env.SUPABASE_BUCKET || 'notiflex';
const supabaseStorage = createClient(SUPABASE_URL, SUPABASE_KEY);

// Utilitas: Ekstrak teks dari PDF atau gambar
async function extractText(fileBuffer, mimetype) {
  let text = '';
  if (mimetype === 'application/pdf') {
    try {
      const pdfData = await pdfParse(fileBuffer);
      text = pdfData.text?.trim() || '';
    } catch (e) {
      text = '';
    }
  } else if (mimetype.startsWith('image/')) {
    try {
      const ocrResult = await Tesseract.recognize(fileBuffer, 'ind');
      text = ocrResult.data.text;
    } catch (e) {
      text = '';
    }
  }
  return text;
}

// GET add item page
router.get('/add/:objectId', simpleMenuCheck('/objects'), async (req, res) => {
  const object_id = req.params.objectId;
  res.render('items-add', { object_id });
});

// POST add item (tanpa AI LLM, hanya ekstrak sederhana)
router.post('/add', simpleMenuCheck('/objects'), upload.single('file'), async (req, res) => {
  const user = req.session.user;
  const { object_id, name, location, notes } = req.body;
  const file = req.file;
  if (!user || !object_id || !name || !file) {
    return res.status(400).json({ success: false, error: 'Missing required fields.' });
  }
  const fileExt = file.originalname.split('.').pop();
  const filePath = `items/${Date.now()}_${file.originalname}`;
  const { data: uploadData, error: uploadError } = await supabaseStorage.storage.from(BUCKET_NAME).upload(filePath, file.buffer, {
    contentType: file.mimetype,
    upsert: true
  });
  if (uploadError) {
    return res.status(400).json({ success: false, error: 'Failed to upload file to storage.' });
  }
  const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${filePath}`;
  // Ekstrak text
  let extractedText = '';
  try {
    extractedText = await extractText(file.buffer, file.mimetype);
  } catch (err) {
    extractedText = '';
  }
  // Title: baris pertama non-kosong
  let title = name;
  if (extractedText) {
    const lines = extractedText.split(/\n|\r/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      title = lines[0];
    }
  }
  // End date: tanggal pertama yang ditemukan
  let endDate = null;
  if (extractedText) {
    const dateRegex = /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2})\b/g;
    const foundDates = extractedText.match(dateRegex);
    if (foundDates && foundDates.length > 0) {
      endDate = foundDates[0];
    }
  }
  // Insert ke table items
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
  // Insert ke table item_detail
  const { error: detailError } = await supabase
    .from('item_detail')
    .insert({
      created_at: new Date().toISOString(),
      name: title,
      file_type: file.mimetype,
      file_size: file.size,
      file_url: fileUrl,
      end_date: endDate,
      item_id: item.id,
      client_id: user.client_id,
      created_by: user.id
    });
  if (detailError) {
    return res.status(400).json({ success: false, error: detailError.message });
  }
  res.json({ success: true });
});

module.exports = router; 