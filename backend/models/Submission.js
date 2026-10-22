import mongoose from 'mongoose';

const submissionSchema = new mongoose.Schema(
  {
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assignment',
      required: [true, 'Assignment ID is required']
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student ID is required']
    },
    submissionLink: {
      type: String,
      required: [true, 'Submission link is required'],
      trim: true,
      match: [
        /^https?:\/\/.+/,
        'Submission link must be a valid URL starting with http:// or https://'
      ]
    },
    comments: {
      type: String,
      maxlength: [1000, 'Comments cannot exceed 1000 characters'],
      default: ''
    },
    submittedAt: {
      type: Date,
      default: Date.now
    },
    isLate: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      enum: ['submitted', 'reviewed'],
      default: 'submitted'
    },
    marks: {
      type: Number,
      min: [0, 'Marks cannot be negative']
    },
    feedback: {
      type: String,
      maxlength: [2000, 'Feedback cannot exceed 2000 characters'],
      default: ''
    },
    reviewedAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

submissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });

const Submission = mongoose.model('Submission', submissionSchema);

export default Submission;
