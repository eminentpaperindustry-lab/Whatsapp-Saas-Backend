// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Authorization required' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = { id: user._id, role: user.role };
    req.tenantId = payload.tenantId || user.tenantId;
    next();
  } catch (err) {
    console.error('Auth error', err);
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = requireAuth;
