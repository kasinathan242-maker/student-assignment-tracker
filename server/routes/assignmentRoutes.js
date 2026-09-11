const express = require('express');
const router = express.Router();
const Assignment = require('../models/Assignment');

router.get('/', async (req, res) => {
  try {
    const assignments = await Assignment.find().sort({ createdAt: -1 });
    res.json(assignments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      title,
      dueDate,
      maxMarks,
      teacherName,
      teacherId,
      description,
      instructions,
      courseId,
      courseName,
      classId,
      className,
      subject,
      startDate,
      priority,
      status,
      attachmentName,
      attachmentUrl
    } = req.body;

    const assignment = new Assignment({
      title,
      dueDate: dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      maxMarks: maxMarks ? Number(maxMarks) : 25,
      teacherName: teacherName || 'Mohan Kasinathan',
      teacherId: teacherId || '',
      description: description || '',
      instructions: instructions || description || '',
      courseId: courseId || 'c-1',
      courseName: courseName || 'Computer Science',
      classId: classId || 'cls-1',
      className: className || 'Batch A',
      subject: subject || 'General',
      startDate: startDate || new Date(),
      priority: priority || 'normal',
      attachmentName: attachmentName || null,
      attachmentUrl: attachmentUrl || '#',
      status: status || 'published'
    });
    await assignment.save();
    res.status(201).json(assignment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updated = await Assignment.findByIdAndUpdate(
      req.params.id,
      { ...req.body },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Assignment not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Assignment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Assignment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
