const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.get('/', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, rollNumber, department } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) return res.status(400).json({ message: 'Email already exists' });

    const user = new User({
      name,
      email: cleanEmail,
      password: password || '123456',
      role: role || 'student',
      rollNumber: rollNumber || (role === 'student' ? `CS2026-${Math.floor(100 + Math.random() * 900)}` : ''),
      department: department || 'Computer Science'
    });
    await user.save();
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();
    const user = await User.findOne({ email: cleanEmail, password });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    user.lastLogin = new Date();
    await user.save();

    res.json({ message: 'Login successful', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/seed', async (req, res) => {
  try {
    const demoAccounts = [
      {
        name: 'Mohan Student',
        email: 'student@example.com',
        password: '123456',
        role: 'student',
        rollNumber: 'CS2026-001',
        department: 'Computer Science'
      },
      {
        name: 'Prof. Kasinathan',
        email: 'teacher@example.com',
        password: '123456',
        role: 'teacher',
        rollNumber: '',
        department: 'Computer Science'
      },
      {
        name: 'Dr. Mohan (HOD)',
        email: 'admin@example.com',
        password: '123456',
        role: 'admin',
        rollNumber: '',
        department: 'Computer Science & Engineering'
      }
    ];

    const results = [];
    for (const acc of demoAccounts) {
      let existing = await User.findOne({ email: acc.email });
      if (!existing) {
        existing = new User(acc);
        await existing.save();
      } else if (existing.role !== acc.role) {
        existing.role = acc.role;
        await existing.save();
      }
      results.push(existing);
    }
    res.json({ message: 'Demo accounts ready', users: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
