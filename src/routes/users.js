// src/routes/users.js
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const User = require('../models/User');

// Admin creates user under same tenant
router.post('/', requireAuth, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { name, email, password, role } = req.body;
    const user = new User({ tenantId: req.tenantId, name, email: email.toLowerCase(), role: role || 'user' });
    await user.setPassword(password || 'changeme123');
    await user.save();
    res.json({ id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    console.error(err);
    if (err.code === 11000) return res.status(400).json({ error: 'Email already used' });
    res.status(500).json({ error: 'Server error' });
  }
});

// List users in tenant (admin only)
router.get('/', requireAuth, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const users = await User.find({ tenantId: req.tenantId }).select('name email role createdAt');
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
