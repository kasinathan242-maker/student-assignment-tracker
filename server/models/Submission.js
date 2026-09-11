const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  assignmentId: { type: String, required: true, index: true },
  studentId: { type: String, required: true, index: true },
  studentName: { type: String, required: true },
  studentEmail: { type: String, default: '' },
  rollNumber: { type: String, default: '' },
  fileName: { type: String, default: 'assignment.pdf' },
  fileSize: { type: String, default: '1.2 MB' },
  fileUrl: { type: String, default: '#' },
  comment: { type: String, default: '' },
  submittedAt: { type: Date, default: Date.now },
  isLate: { type: Boolean, default: false },
  status: { type: String, enum: ['submitted', 'graded'], default: 'submitted' },
  marks: { type: Number, default: null },
  feedback: { type: String, default: null },
  gradedAt: { type: Date, default: null },
  gradedBy: { type: String, default: null }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

submissionSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

module.exports = mongoose.model('Submission', submissionSchema, 'submissions');
