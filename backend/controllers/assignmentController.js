import Assignment from '../models/Assignment.js';
import Submission from '../models/Submission.js';
import asyncHandler from '../utils/asyncHandler.js';
import { deriveStatus, formatRemainingTime } from '../utils/status.js';

export const createAssignment = asyncHandler(async (req, res) => {
  const { title, description, subject, deadline, maxMarks } = req.body;

  if (new Date(deadline) <= new Date()) {
    return res.status(400).json({
      message: 'Deadline must be a future date'
    });
  }

  const assignment = await Assignment.create({
    title,
    description,
    subject,
    deadline,
    maxMarks,
    createdBy: req.user._id
  });

  res.status(201).json(assignment);
});

export const getAssignments = asyncHandler(async (req, res) => {
  const {
    search,
    subject,
    sort = 'deadline',
    page = 1,
    limit = 10
  } = req.query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 10);
  const skip = (pageNum - 1) * limitNum;

  const query = {};

  if (req.user.role === 'teacher') {
    query.createdBy = req.user._id;
  }

  if (search && search.trim() !== '') {
    const searchRegex = new RegExp(search.trim(), 'i');
    query.$or = [{ title: searchRegex }, { subject: searchRegex }];
  }

  if (subject && subject.trim() !== '') {
    query.subject = { $regex: new RegExp(`^${subject.trim()}$`, 'i') };
  }

  const sortOptions = {};
  if (sort === '-deadline') {
    sortOptions.deadline = -1;
  } else if (sort === 'createdAt') {
    sortOptions.createdAt = -1;
  } else {
    sortOptions.deadline = 1;
  }

  const total = await Assignment.countDocuments(query);
  const assignments = await Assignment.find(query)
    .populate('createdBy', 'name email')
    .sort(sortOptions)
    .skip(skip)
    .limit(limitNum)
    .lean();

  const assignmentIds = assignments.map((a) => a._id);

  let enriched = [];

  if (req.user.role === 'teacher') {
    const submissionCounts = await Submission.aggregate([
      { $match: { assignmentId: { $in: assignmentIds } } },
      { $group: { _id: '$assignmentId', count: { $sum: 1 } } }
    ]);
    const countMap = new Map(
      submissionCounts.map((c) => [c._id.toString(), c.count])
    );

    enriched = assignments.map((a) => ({
      ...a,
      submissionCount: countMap.get(a._id.toString()) || 0,
      remainingTime: formatRemainingTime(a.deadline)
    }));
  } else {
    const submissions = await Submission.find({
      studentId: req.user._id,
      assignmentId: { $in: assignmentIds }
    }).lean();

    const submissionMap = new Map(
      submissions.map((s) => [s.assignmentId.toString(), s])
    );

    enriched = assignments.map((a) => {
      const submission = submissionMap.get(a._id.toString()) || null;
      return {
        ...a,
        submission,
        derivedStatus: deriveStatus(a.deadline, submission),
        remainingTime: formatRemainingTime(a.deadline)
      };
    });
  }

  res.json({
    assignments: enriched,
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      limit: limitNum
    }
  });
});

export const getAssignmentById = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id)
    .populate('createdBy', 'name email')
    .lean();

  if (!assignment) {
    return res.status(404).json({
      message: 'Assignment not found'
    });
  }

  if (req.user.role === 'student') {
    const submission = await Submission.findOne({
      assignmentId: assignment._id,
      studentId: req.user._id
    }).lean();

    return res.json({
      ...assignment,
      submission: submission || null,
      derivedStatus: deriveStatus(assignment.deadline, submission),
      remainingTime: formatRemainingTime(assignment.deadline)
    });
  }

  const submissionCount = await Submission.countDocuments({
    assignmentId: assignment._id
  });

  res.json({
    ...assignment,
    submissionCount,
    remainingTime: formatRemainingTime(assignment.deadline)
  });
});

export const updateAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);

  if (!assignment) {
    return res.status(404).json({
      message: 'Assignment not found'
    });
  }

  if (assignment.createdBy.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      message: 'Not authorized to update this assignment'
    });
  }

  const { title, description, subject, deadline, maxMarks } = req.body;

  if (title) assignment.title = title;
  if (description) assignment.description = description;
  if (subject) assignment.subject = subject;
  if (deadline) assignment.deadline = deadline;
  if (maxMarks) assignment.maxMarks = maxMarks;

  const updatedAssignment = await assignment.save();
  res.json(updatedAssignment);
});

export const deleteAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);

  if (!assignment) {
    return res.status(404).json({
      message: 'Assignment not found'
    });
  }

  if (assignment.createdBy.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      message: 'Not authorized to delete this assignment'
    });
  }

  await Assignment.findByIdAndDelete(assignment._id);
  await Submission.deleteMany({ assignmentId: assignment._id });

  res.json({
    message: 'Assignment and related submissions deleted successfully'
  });
});
