// src/routes/contacts.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const requireAuth = require('../middleware/auth');
const Contact = require('../models/Contact');
const { validatePhone } = require('../utils/validators');

const upload = multer({ dest: 'src/uploads/' });

// Create contact
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, phone, tags, section } = req.body;
    if (!validatePhone(phone)) return res.status(400).json({ error: 'Invalid phone format' });
    const doc = await Contact.create({ tenantId: req.tenantId, name, phone, tags, section });
    res.json(doc);
  } catch (err) {
    console.error(err);
    if (err.code === 11000) return res.status(400).json({ error: 'Contact already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// List contacts
router.get('/', requireAuth, async (req, res) => {
  try {
    const { page=1, limit=50, q='', section } = req.query;
    const query = { tenantId: req.tenantId, $or: [{ name: new RegExp(q,'i') }, { phone: new RegExp(q,'i') }] };
    if(section) query.section = section;
    const data = await Contact.find(query).skip((page-1)*limit).limit(Number(limit));
    const total = await Contact.countDocuments(query);
    res.json({ data, total });
  } catch(err) { res.status(500).json({ error: 'Server error' }) }
});

// Bulk import
router.post('/import', requireAuth, upload.single('file'), async (req,res)=>{
  try{
    if(!req.file) return res.status(400).json({ error: 'No file' });
    const filePath = req.file.path;
    const imported=[];
    const tenantId = req.tenantId;
    const section = req.body.section;

    const ext = path.extname(req.file.originalname).toLowerCase();

    const processRow = async r => {
      const phone = (r.phone || r.phone_number || r.mobile || '').toString().trim();
      if(!validatePhone(phone)) return;
      try { await Contact.create({ tenantId, name: r.name || r.fullname || '', phone, tags: r.tags ? r.tags.split(',').map(s=>s.trim()) : [], section }); imported.push(phone); } catch(err){}
    }

    if(ext==='.csv'){
      const rows=[];
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', row=>rows.push(row))
        .on('end', async ()=>{
          for(const r of rows) await processRow(r);
          fs.unlinkSync(filePath);
          res.json({ imported: imported.length });
        });
    } else {
      const wb = XLSX.readFile(filePath);
      const sheet = wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet]);
      for(const r of rows) await processRow(r);
      fs.unlinkSync(filePath);
      res.json({ imported: imported.length });
    }
  }catch(err){ console.error(err); res.status(500).json({ error: 'Import failed' }) }
});

// Delete
router.delete('/:id', requireAuth, async (req,res)=>{
  try{ await Contact.deleteOne({ _id:req.params.id, tenantId:req.tenantId }); res.json({ success:true }) } 
  catch(err){ res.status(500).json({ error:'Server error' }) }
});

module.exports = router;
