// src/routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const nodemailer = require('nodemailer');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const JWT_EXP = process.env.JWT_EXPIRY || '7d';

// configure transporter (Mailtrap for dev)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// Register: create tenant + admin user
router.post('/register', async (req, res) => {
  try {
    const { tenantName, adminName, email, password } = req.body;
    if (!tenantName || !adminName || !email || !password) return res.status(400).json({ error: 'Missing fields' });

    const tenant = await Tenant.create({ name: tenantName, contact_email: email });
    const user = new User({ tenantId: tenant._id, name: adminName, email: email.toLowerCase(), role: 'admin' });
    await user.setPassword(password);
    await user.save();

    const token = jwt.sign({ userId: user._id, tenantId: tenant._id }, process.env.JWT_SECRET, { expiresIn: JWT_EXP });
    res.json({ token, user: { id: user._id, email: user.email, role: user.role }, tenant: { id: tenant._id, name: tenant.name } });
  } catch (err) {
    console.error(err);
    if (err.code === 11000) return res.status(400).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await user.validatePassword(password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user._id, tenantId: user.tenantId }, process.env.JWT_SECRET, { expiresIn: JWT_EXP });
    res.json({ token, user: { id: user._id, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Forgot password - sends reset link with token
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ message: 'If user exists, reset link sent' });
    const token = user.createResetToken();
    await user.save();
    const resetUrl = `${FRONTEND_URL}/reset-password/${token}`;
    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: user.email,
      subject: 'Password reset',
      html: `<p>Reset your password: <a href="${resetUrl}">${resetUrl}</a></p>`
    });
    res.json({ message: 'If user exists, reset link sent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset password
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;
    const user = await User.findOne({ resetToken: token, resetTokenExpiry: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ error: 'Invalid or expired token' });
    await user.setPassword(password);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();
    res.json({ message: 'Password reset successful' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
