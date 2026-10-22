import Assignment from '../models/Assignment.js';
import Submission from '../models/Submission.js';
import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';
import { deriveStatus } from '../utils/status.js';

export const getStudentDashboard = asyncHandler(async (req, res) => {
  const assignments = await Assignment.find().select('_id deadline maxMarks').lean();
  const submissions = await Submission.find({ studentId: req.user._id }).lean();

  const submissionMap = new Map(
    submissions.map((s) => [s.assignmentId.toString(), s])
  );

  let pending = 0;
  let overdue = 0;
  let submitted = 0;
  let submittedLate = 0;
  let reviewed = 0;
  let totalPercentage = 0;

  for (const assignment of assignments) {
    const sub = submissionMap.get(assignment._id.toString()) || null;
    const status = deriveStatus(assignment.deadline, sub);

    if (status === 'pending') pending++;
    else if (status === 'overdue') overdue++;
    else if (status === 'submitted') submitted++;
    else if (status === 'submitted_late') submittedLate++;
    else if (status === 'reviewed') {
      reviewed++;
      if (typeof sub.marks === 'number' && assignment.maxMarks > 0) {
        totalPercentage += (sub.marks / assignment.maxMarks) * 100;
      }
    }
  }

  const averagePercentage =
    reviewed > 0 ? Math.round((totalPercentage / reviewed) * 10) / 10 : 0;

  res.json({
    total: assignments.length,
    pending,
    submitted,
    submittedLate,
    overdue,
    reviewed,
    averagePercentage
  });
});

export const getTeacherDashboard = asyncHandler(async (req, res) => {
  const teacherAssignments = await Assignment.find({ createdBy: req.user._id })
    .select('_id')
    .lean();

  const assignmentIds = teacherAssignments.map((a) => a._id);

  const [totalStudents, totalSubmissions, pendingReviews, upcomingDeadlines] =
    await Promise.all([
      User.countDocuments({ role: 'student' }),
      Submission.countDocuments({ assignmentId: { $in: assignmentIds } }),
      Submission.countDocuments({
        assignmentId: { $in: assignmentIds },
        status: 'submitted'
      }),
      Assignment.find({
        createdBy: req.user._id,
        deadline: { $gte: new Date() }
      })
        .sort({ deadline: 1 })
        .limit(5)
        .lean()
    ]);

  res.json({
    totalAssignments: teacherAssignments.length,
    totalStudents,
    totalSubmissions,
    pendingReviews,
    upcomingDeadlines
  });
});
