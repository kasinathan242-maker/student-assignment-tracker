import mongoose from 'mongoose';

const assignmentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Assignment title is required'],
      trim: true,
      maxlength: [120, 'Title cannot exceed 120 characters']
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      maxlength: [5000, 'Description cannot exceed 5000 characters']
    },
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true,
      maxlength: [60, 'Subject cannot exceed 60 characters']
    },
    deadline: {
      type: Date,
      required: [true, 'Deadline is required']
    },
    maxMarks: {
      type: Number,
      required: [true, 'Maximum marks is required'],
      min: [1, 'Maximum marks must be at least 1'],
      max: [1000, 'Maximum marks cannot exceed 1000']
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Creator is required']
    }
  },
  {
    timestamps: true
  }
);

assignmentSchema.index({ deadline: 1 });
assignmentSchema.index({ createdBy: 1 });

const Assignment = mongoose.model('Assignment', assignmentSchema);

export default Assignment;
