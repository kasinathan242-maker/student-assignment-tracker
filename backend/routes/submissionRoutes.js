import express from 'express';
import { body } from 'express-validator';
import {
  submitAssignment,
  getMySubmissions,
  getAssignmentSubmissions,
  reviewSubmission
} from '../controllers/submissionController.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();

router.use(protect);

router.post(
  '/',
  authorize('student'),
  [
    body('assignmentId').isMongoId().withMessage('Valid assignment ID is required'),
    body('submissionLink')
      .trim()
      .isURL()
      .withMessage('Submission link must be a valid URL'),
    body('comments')
      .optional()
      .isLength({ max: 1000 })
      .withMessage('Comments cannot exceed 1000 characters'),
    validate
  ],
  submitAssignment
);

router.get('/my', authorize('student'), getMySubmissions);

router.get(
  '/assignment/:assignmentId',
  authorize('teacher'),
  getAssignmentSubmissions
);

router.put(
  '/:id/review',
  authorize('teacher'),
  [
    body('marks')
      .notEmpty()
      .withMessage('Marks is required')
      .isNumeric()
      .withMessage('Marks must be a numeric value'),
    body('feedback')
      .optional()
      .isLength({ max: 2000 })
      .withMessage('Feedback cannot exceed 2000 characters'),
    validate
  ],
  reviewSubmission
);

export default router;
