const express = require('express');
const router = express.Router();
const { supabase } = require('../supabaseClient');
const { simpleMenuCheck } = require('../middleware/simpleAuth');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BUCKET_NAME = process.env.SUPABASE_BUCKET || 'notiflex';
const supabaseStorage = createClient(SUPABASE_URL, SUPABASE_KEY);

// Utilitas: Ekstrak teks dari PDF (pdf-parse), fallback ke OCR jika kosong
async function extractTextWithFallback(fileBuffer, mimetype) {
  let text = '';
  if (mimetype === 'application/pdf') {
    try {
      const pdfData = await pdfParse(fileBuffer);
      text = pdfData.text?.trim() || '';
      console.log('PDF parse result length:', text.length);
    } catch (e) {
      console.log('PDF parse error:', e.message);
      text = '';
    }
    if (!text || text.replace(/\n/g, '').length < 10) {
      console.log('Text too short, skipping OCR fallback (poppler removed)...');
    }
  } else if (mimetype.startsWith('image/')) {
    console.log('Processing image file with OCR...');
    const ocrResult = await Tesseract.recognize(fileBuffer, 'ind');
    text = ocrResult.data.text;
    console.log('Image OCR result length:', text.length);
  }
  return text;
}

// GET add item page
router.get('/add/:objectId', simpleMenuCheck('/objects'), async (req, res) => {
  const object_id = req.params.objectId;
  res.render('items-add', { object_id });
});

// POST add item
router.post('/add', simpleMenuCheck('/objects'), upload.single('file'), async (req, res) => {
  const user = req.session.user;
  const { object_id, name, location, notes, title, end_date } = req.body;
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
  let extractedText = '';
  try {
    extractedText = await extractTextWithFallback(file.buffer, file.mimetype);
  } catch (err) {
    extractedText = '';
    console.log('extractTextWithFallback error:', err);
  }
  let aiTitle = title || name;
  let aiEndDate = end_date || null;
  // Fallback if extractedText is empty or too short
  if (!extractedText || extractedText.replace(/\n/g, '').length < 10) {
    aiTitle = name || file.originalname.replace(/\.[^/.]+$/, '');
    aiEndDate = null;
  } else {
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
    let foundDates = extractedText.match(dateRegex);
    let endDateLine = null;
    if (extractedText) {
      for (const line of lines) {
        const lower = line.toLowerCase();
        const hasConnector = endDateKeywords.some(keyword => lower.includes(keyword));
        const datesInLine = line.match(dateRegex);
        if (datesInLine && datesInLine.length >= 2 && hasConnector) {
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
            aiEndDate = datesInLine[1];
            break;
          }
        }
      }
      // 4. Jika belum ketemu, fallback ke tanggal pertama di dokumen
      if (!aiEndDate && foundDates && foundDates.length > 0) {
        // Cari tanggal terbesar (terakhir secara urutan dokumen)
        let parsedDates = foundDates.map(d => parseDateFlexible(d)).filter(Boolean);
        if (parsedDates.length > 0) {
          // Ambil tanggal terbesar (paling akhir)
          let maxDate = parsedDates.reduce((a, b) => a > b ? a : b);
          // Format kembali ke string asli yang cocok
          let idx = parsedDates.findIndex(d => d.getTime() === maxDate.getTime());
          aiEndDate = foundDates[idx];
        } else {
          aiEndDate = foundDates[0];
        }
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
router.post('/ai-extract', simpleMenuCheck('/objects'), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ success: false, error: 'No file uploaded.' });
  let extractedText = '';
  try {
    extractedText = await extractTextWithFallback(file.buffer, file.mimetype);
    let aiTitle = '';
    let aiEndDate = '';
    // Fallback if extractedText is empty or too short
    if (!extractedText || extractedText.replace(/\n/g, '').length < 10) {
      aiTitle = file.originalname.replace(/\.[^/.]+$/, '');
      aiEndDate = null;
    } else {
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
        'berakhir', 'berakhir pada tanggal', 'sampai', 'hingga', 'selesai', 'end', 'valid until', 'berlaku sampai', 'berlaku hingga', 'masa berlaku', 'tanggal akhir', 'expiry', 'exp', 'berakhir pada', 's.d.', 'sd', 's.d', 'sampai dengan', 'sampai tanggal', 'hingga tanggal', 'berakhir tanggal', 'berlaku sampai dengan', 'berlaku s.d.'
      ];
      let foundDates = extractedText.match(dateRegex);
      let endDateLine = null;
      if (extractedText) {
        for (const line of lines) {
          const lower = line.toLowerCase();
          const hasConnector = endDateKeywords.some(keyword => lower.includes(keyword));
          const datesInLine = line.match(dateRegex);
          if (datesInLine && datesInLine.length >= 2 && hasConnector) {
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
              aiEndDate = datesInLine[1];
              break;
            }
          }
        }
        // 4. Jika belum ketemu, fallback ke tanggal pertama di dokumen
        if (!aiEndDate && foundDates && foundDates.length > 0) {
          // Cari tanggal terbesar (terakhir secara urutan dokumen)
          let parsedDates = foundDates.map(d => parseDateFlexible(d)).filter(Boolean);
          if (parsedDates.length > 0) {
            // Ambil tanggal terbesar (paling akhir)
            let maxDate = parsedDates.reduce((a, b) => a > b ? a : b);
            // Format kembali ke string asli yang cocok
            let idx = parsedDates.findIndex(d => d.getTime() === maxDate.getTime());
            aiEndDate = foundDates[idx];
          } else {
            aiEndDate = foundDates[0];
          }
        }
        if (!aiEndDate) {
          console.log('DEBUG: No end date found in extracted text.');
        }
      }
    }
    console.log('Extracted for AI:', { aiTitle, aiEndDate, extractedText: extractedText?.slice(0, 200) });
    return res.json({ success: true, title: aiTitle, end_date: aiEndDate });
  } catch (err) {
    console.log('AI extract error:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;

function parseDateFlexible(str) {
  // Coba parse berbagai format tanggal Indonesia/English
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