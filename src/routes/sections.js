// src/routes/sections.js
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const Section = require('../models/Section');

// List sections
router.get('/', requireAuth, async (req,res)=>{
  try{
    
    const sections = await Section.find({ tenantId:req.tenantId });
    res.json(sections);
  }catch(err){ res.status(500).json({ error:'Failed to load sections' }) }
});

// Create section
router.post('/', requireAuth, async (req,res)=>{
  try{
    const { name } = req.body;
    if(!name) return res.status(400).json({ error:'Section name required' });
    const section = await Section.create({ tenantId:req.tenantId, name });
    res.json(section);
  }catch(err){
    if(err.code===11000) return res.status(400).json({ error:'Section already exists' });
    res.status(500).json({ error:'Failed to create section' });
  }
});

module.exports = router;
