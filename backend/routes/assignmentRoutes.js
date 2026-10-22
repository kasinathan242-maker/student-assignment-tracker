import express from 'express';
import { body } from 'express-validator';
import {
  createAssignment,
  getAssignments,
  getAssignmentById,
  updateAssignment,
  deleteAssignment
} from '../controllers/assignmentController.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(getAssignments)
  .post(
    authorize('teacher'),
    [
      body('title')
        .trim()
        .notEmpty()
        .withMessage('Title is required')
        .isLength({ max: 120 })
        .withMessage('Title cannot exceed 120 characters'),
      body('description')
        .trim()
        .notEmpty()
        .withMessage('Description is required')
        .isLength({ max: 5000 })
        .withMessage('Description cannot exceed 5000 characters'),
      body('subject')
        .trim()
        .notEmpty()
        .withMessage('Subject is required')
        .isLength({ max: 60 })
        .withMessage('Subject cannot exceed 60 characters'),
      body('deadline')
        .isISO8601()
        .withMessage('A valid deadline date is required'),
      body('maxMarks')
        .isInt({ min: 1, max: 1000 })
        .withMessage('Maximum marks must be an integer between 1 and 1000'),
      validate
    ],
    createAssignment
  );

router
  .route('/:id')
  .get(getAssignmentById)
  .put(
    authorize('teacher'),
    [
      body('title')
        .optional()
        .trim()
        .notEmpty()
        .withMessage('Title cannot be empty')
        .isLength({ max: 120 })
        .withMessage('Title cannot exceed 120 characters'),
      body('description')
        .optional()
        .trim()
        .notEmpty()
        .withMessage('Description cannot be empty')
        .isLength({ max: 5000 })
        .withMessage('Description cannot exceed 5000 characters'),
      body('subject')
        .optional()
        .trim()
        .notEmpty()
        .withMessage('Subject cannot be empty')
        .isLength({ max: 60 })
        .withMessage('Subject cannot exceed 60 characters'),
      body('deadline')
        .optional()
        .isISO8601()
        .withMessage('A valid deadline date is required'),
      body('maxMarks')
        .optional()
        .isInt({ min: 1, max: 1000 })
        .withMessage('Maximum marks must be an integer between 1 and 1000'),
      validate
    ],
    updateAssignment
  )
  .delete(authorize('teacher'), deleteAssignment);

export default router;
