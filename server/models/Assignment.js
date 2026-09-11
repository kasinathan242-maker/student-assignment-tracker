const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  instructions: { type: String, default: '' },
  courseId: { type: String, default: 'c-1' },
  courseName: { type: String, default: 'Computer Science' },
  classId: { type: String, default: 'cls-1' },
  className: { type: String, default: 'Batch A' },
  subject: { type: String, default: 'General' },
  startDate: { type: Date, default: Date.now },
  dueDate: { type: Date, required: true },
  maxMarks: { type: Number, default: 25 },
  teacherId: { type: String, default: '' },
  teacherName: { type: String, default: 'KASINATHAN M' },
  priority: { type: String, default: 'normal' },
  attachmentName: { type: String, default: null },
  attachmentUrl: { type: String, default: '#' },
  status: { type: String, default: 'published' },
  createdAt: { type: Date, default: Date.now }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

assignmentSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

module.exports = mongoose.model('Assignment', assignmentSchema, 'assignments');
