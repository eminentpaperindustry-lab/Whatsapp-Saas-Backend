// src/routes/media.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cloudinary = require('../config/cloudinary');
const requireAuth = require('../middleware/auth');

const upload = multer({ dest: 'src/uploads/' });
const router = express.Router();

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const filePath = req.file.path;
    const result = await cloudinary.uploader.upload(filePath, { resource_type: 'auto', folder: `tenant_${req.tenantId}` });
    fs.unlinkSync(filePath);
    res.json({ url: result.secure_url, resource_type: result.resource_type, bytes: result.bytes });
  } catch (err) {
    console.error('upload error', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;
