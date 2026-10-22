import Assignment from '../models/Assignment.js';
import Submission from '../models/Submission.js';
import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';

export const submitAssignment = asyncHandler(async (req, res) => {
  const { assignmentId, submissionLink, comments } = req.body;

  const assignment = await Assignment.findById(assignmentId);
  if (!assignment) {
    return res.status(404).json({
      message: 'Assignment not found'
    });
  }

  const existingSubmission = await Submission.findOne({
    assignmentId: assignment._id,
    studentId: req.user._id
  });

  const now = new Date();
  const isLate = now > new Date(assignment.deadline);

  if (existingSubmission) {
    if (existingSubmission.status === 'reviewed') {
      return res.status(400).json({
        message: 'Cannot edit or resubmit an assignment that has already been reviewed'
      });
    }

    existingSubmission.submissionLink = submissionLink;
    existingSubmission.comments = comments !== undefined ? comments : existingSubmission.comments;
    existingSubmission.submittedAt = now;
    existingSubmission.isLate = isLate;

    const updated = await existingSubmission.save();
    return res.json(updated);
  }

  const submission = await Submission.create({
    assignmentId: assignment._id,
    studentId: req.user._id,
    submissionLink,
    comments: comments || '',
    submittedAt: now,
    isLate,
    status: 'submitted'
  });

  res.status(201).json(submission);
});

export const getMySubmissions = asyncHandler(async (req, res) => {
  const submissions = await Submission.find({ studentId: req.user._id })
    .populate('assignmentId', 'title subject deadline maxMarks')
    .sort({ submittedAt: -1 })
    .lean();

  res.json(submissions);
});

export const getAssignmentSubmissions = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.assignmentId).lean();

  if (!assignment) {
    return res.status(404).json({
      message: 'Assignment not found'
    });
  }

  if (assignment.createdBy.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      message: 'Not authorized to view submissions for this assignment'
    });
  }

  const submissions = await Submission.find({
    assignmentId: assignment._id
  })
    .populate('studentId', 'name email')
    .sort({ submittedAt: -1 })
    .lean();

  const allStudents = await User.find({ role: 'student' })
    .select('name email')
    .lean();

  const submittedStudentIds = new Set(
    submissions.map((s) => s.studentId?._id?.toString() || s.studentId?.toString())
  );

  const notSubmittedStudents = allStudents.filter(
    (student) => !submittedStudentIds.has(student._id.toString())
  );

  res.json({
    assignment,
    submissions,
    notSubmittedStudents
  });
});

export const reviewSubmission = asyncHandler(async (req, res) => {
  const { marks, feedback } = req.body;

  const submission = await Submission.findById(req.params.id);
  if (!submission) {
    return res.status(404).json({
      message: 'Submission not found'
    });
  }

  const assignment = await Assignment.findById(submission.assignmentId);
  if (!assignment) {
    return res.status(404).json({
      message: 'Associated assignment not found'
    });
  }

  if (assignment.createdBy.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      message: 'Not authorized to review this submission'
    });
  }

  const numericMarks = Number(marks);
  if (isNaN(numericMarks) || numericMarks < 0 || numericMarks > assignment.maxMarks) {
    return res.status(400).json({
      message: `Marks must be between 0 and ${assignment.maxMarks}`
    });
  }

  submission.marks = numericMarks;
  submission.feedback = feedback || '';
  submission.status = 'reviewed';
  submission.reviewedAt = new Date();

  const reviewedSubmission = await submission.save();

  res.json(reviewedSubmission);
});
