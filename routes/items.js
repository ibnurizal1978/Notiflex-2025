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
      if (!text || text.replace(/\n/g, '').length < 10) {
        // Try to extract text from each page if possible
        if (pdfData.numpages && pdfData.numpages > 1 && pdfData.texts) {
          text = pdfData.texts.map(t => t.text).join('\n');
        }
      }
      if (!text || text.replace(/\n/g, '').length < 10) {
        console.warn('PDF text extraction failed or too short. No OCR fallback for PDF.');
      }
    } catch (e) {
      text = '';
      console.warn('PDF parse error:', e);
    }
  } else if (mimetype.startsWith('image/')) {
    try {
      const ocrResult = await Tesseract.recognize(fileBuffer, 'ind');
      text = ocrResult.data.text;
      if (!text || text.replace(/\n/g, '').length < 10) {
        const ocrResultEng = await Tesseract.recognize(fileBuffer, 'eng');
        text = ocrResultEng.data.text;
      }
    } catch (e) {
      text = '';
      console.warn('Image OCR error:', e);
    }
  }
  console.log('PDF/IMG extracted text length:', text.length, '| snippet:', (text||'').slice(0, 200));
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

// Tambahkan endpoint ekstraksi info sederhana
router.post('/extract-info', simpleMenuCheck('/objects'), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ success: false, error: 'No file uploaded.' });
  let extractedText = '';
  try {
    extractedText = await extractText(file.buffer, file.mimetype);
    // Fallback: try English OCR if image and text is empty
    if (!extractedText && file.mimetype.startsWith('image/')) {
      try {
        const ocrResult = await Tesseract.recognize(file.buffer, 'eng');
        extractedText = ocrResult.data.text;
      } catch (e) {}
    }
  } catch (err) {
    extractedText = '';
  }
  // Title: baris pertama non-kosong
  let title = '';
  if (extractedText) {
    const lines = extractedText.split(/\n|\r/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      title = lines[0];
    }
  }
  // Fallback: use filename if title is still empty
  if (!title) {
    title = file.originalname.replace(/\.[^/.]+$/, '');
  }
  // Use findEndDate logic for end date extraction
  let endDate = null;
  if (extractedText) {
    endDate = findEndDate(extractedText);
  }
  console.log('EXTRACTED END DATE:', endDate, '| from text:', (extractedText||'').slice(0, 200));
  res.json({ success: true, title, end_date: endDate });
});

module.exports = router;

function parseDateFlexible(str) {
  str = str.replace(/\s+/, ' ').trim();
  // dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd, yyyy/mm/dd
  let d = str.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (d) {
    let [_, a, b, c] = d;
    if (c.length === 4) return new Date(`${c}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`);
    if (a.length === 4) return new Date(`${a}-${b.padStart(2,'0')}-${c.padStart(2,'0')}`);
    return new Date(`${c.length===4?c:a}-${b.padStart(2,'0')}-${a.length===4?a:c}`);
  }
  // dd Month yyyy (Indonesia/English)
  let m = str.match(/(\d{1,2})[. ]([a-zA-Z]+)[. ](\d{2,4})/);
  if (m) {
    let [_, day, month, year] = m;
    const months = {
      januari:0, feb:1, februari:1, maret:2, april:3, mei:4, june:5, juni:5, juli:6, august:7, agustus:7, september:8, oktober:9, october:9, november:10, desember:11, december:11, january:0, february:1, march:2, april:3, may:4, june:5, july:6, august:7, september:8, november:10, december:11
    };
    let mon = months[month.toLowerCase()];
    if (mon !== undefined) return new Date(parseInt(year), mon, parseInt(day));
  }
  // yyyy-mm-dd
  let y = str.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (y) return new Date(`${y[1]}-${y[2].padStart(2,'0')}-${y[3].padStart(2,'0')}`);
  // fallback
  let d2 = Date.parse(str);
  if (!isNaN(d2)) return new Date(d2);
  return null;
}

function findEndDate(fullText) {
    // Regex untuk DD-MM-YYYY, DD/MM/YYYY
    let dateRegex1 = /(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/g;
    // Regex untuk YYYY-MM-DD
    let dateRegex2 = /(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/g;
    // Regex untuk DD Month YYYY (e.g., 15 January 2025)
    let dateRegex3 = /(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/gi;

    let matches = [];
    let match;

    while ((match = dateRegex1.exec(fullText)) !== null) {
        matches.push(match[0]);
    }
    while ((match = dateRegex2.exec(fullText)) !== null) {
        matches.push(match[0]);
    }
    while ((match = dateRegex3.exec(fullText)) !== null) {
        matches.push(match[0]);
    }

    console.log('All potential dates found:', matches);

    if (matches.length > 0) {
        return matches[matches.length - 1];
    }
    return null;
} 