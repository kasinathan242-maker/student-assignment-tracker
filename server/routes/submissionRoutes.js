const express = require('express');
const router = express.Router();
const Submission = require('../models/Submission');

router.get('/', async (req, res) => {
  try {
    const submissions = await Submission.find().sort({ createdAt: -1 });
    res.json(submissions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/assignment/:assignmentId', async (req, res) => {
  try {
    const submissions = await Submission.find({ assignmentId: req.params.assignmentId });
    res.json(submissions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/student/:studentId', async (req, res) => {
  try {
    const submissions = await Submission.find({ studentId: req.params.studentId });
    res.json(submissions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      assignmentId,
      studentId,
      studentName,
      studentEmail,
      rollNumber,
      fileName,
      fileSize,
      fileUrl,
      comment,
      isLate
    } = req.body;

    if (!assignmentId || !studentId) {
      return res.status(400).json({ message: 'assignmentId and studentId are required' });
    }

    let submission = await Submission.findOne({ assignmentId, studentId });

    if (submission) {
      submission.fileName = fileName || submission.fileName;
      submission.fileSize = fileSize || submission.fileSize;
      submission.fileUrl = fileUrl || submission.fileUrl;
      submission.comment = comment || submission.comment;
      submission.studentName = studentName || submission.studentName;
      submission.studentEmail = studentEmail || submission.studentEmail;
      submission.rollNumber = rollNumber || submission.rollNumber;
      submission.isLate = typeof isLate === 'boolean' ? isLate : submission.isLate;
      submission.submittedAt = new Date();
      submission.status = 'submitted';
      await submission.save();
      return res.json(submission);
    }

    submission = new Submission({
      assignmentId,
      studentId,
      studentName: studentName || 'Student',
      studentEmail: studentEmail || '',
      rollNumber: rollNumber || '',
      fileName: fileName || 'assignment.pdf',
      fileSize: fileSize || '1.2 MB',
      fileUrl: fileUrl || '#',
      comment: comment || '',
      isLate: Boolean(isLate),
      status: 'submitted',
      submittedAt: new Date()
    });

    await submission.save();
    res.status(201).json(submission);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/grade', async (req, res) => {
  try {
    const { marks, feedback, teacherName } = req.body;
    const submission = await Submission.findById(req.params.id);

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    submission.marks = typeof marks === 'number' ? marks : Number(marks);
    submission.feedback = feedback || '';
    submission.gradedBy = teacherName || 'Faculty Instructor';
    submission.gradedAt = new Date();
    submission.status = 'graded';

    await submission.save();
    res.json(submission);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Submission.findByIdAndDelete(req.params.id);
    res.json({ message: 'Submission deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
