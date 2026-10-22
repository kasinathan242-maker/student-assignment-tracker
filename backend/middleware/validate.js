import { validationResult } from 'express-validator';

export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: 'Validation error',
      errors: errors.array().map((err) => ({
        field: err.path || err.param || 'field',
        msg: err.msg
      }))
    });
  }
  next();
};
