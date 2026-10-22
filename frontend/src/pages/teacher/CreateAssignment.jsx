import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../services/api';

const CreateAssignment = () => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [deadline, setDeadline] = useState('');
  const [maxMarks, setMaxMarks] = useState(100);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    const errors = {};
    if (!title.trim()) {
      errors.title = 'Title is required';
    } else if (title.trim().length > 120) {
      errors.title = 'Title cannot exceed 120 characters';
    }

    if (!subject.trim()) {
      errors.subject = 'Subject is required';
    } else if (subject.trim().length > 60) {
      errors.subject = 'Subject cannot exceed 60 characters';
    }

    if (!description.trim()) {
      errors.description = 'Description is required';
    } else if (description.trim().length > 5000) {
      errors.description = 'Description cannot exceed 5000 characters';
    }

    if (!deadline) {
      errors.deadline = 'Deadline date and time is required';
    } else {
      const selectedDate = new Date(deadline);
      if (selectedDate <= new Date()) {
        errors.deadline = 'Deadline must be a future date and time';
      }
    }

    const marksNum = Number(maxMarks);
    if (!maxMarks || isNaN(marksNum) || marksNum < 1 || marksNum > 1000) {
      errors.maxMarks = 'Max marks must be between 1 and 1000';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/assignments', {
        title: title.trim(),
        subject: subject.trim(),
        description: description.trim(),
        deadline: new Date(deadline).toISOString(),
        maxMarks: marksNum
      });

      navigate('/teacher/assignments');
    } catch (err) {
      if (err.response?.data?.errors) {
        const backendErrors = {};
        err.response.data.errors.forEach((e) => {
          backendErrors[e.field] = e.msg;
        });
        setFieldErrors(backendErrors);
        setError('Please correct the highlighted fields.');
      } else {
        setError(
          err.response?.data?.message || 'Failed to create assignment. Please try again.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container">
      <div className="breadcrumbs">
        <Link to="/teacher/assignments" className="breadcrumb-link">
          ← Back to Manage Assignments
        </Link>
      </div>

      <div className="form-page-layout">
        <div className="form-card">
          <div className="form-card-header">
            <h1 className="form-card-title">Create New Assignment</h1>
            <p className="form-card-subtitle">
              Publish course instructions, set academic deadlines, and specify maximum marks.
            </p>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit} className="standard-form" noValidate>
            <div className="form-group">
              <label htmlFor="assign-title" className="form-label">
                Assignment Title <span className="required-star">*</span>
              </label>
              <input
                id="assign-title"
                type="text"
                className={`form-input ${fieldErrors.title ? 'input-error' : ''}`}
                placeholder="e.g. Distributed Systems: Raft Consensus Implementation"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                required
              />
              <div className="char-count">{title.length}/120</div>
              {fieldErrors.title && (
                <span className="field-error-text">{fieldErrors.title}</span>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="assign-subject" className="form-label">
                  Subject / Course Domain <span className="required-star">*</span>
                </label>
                <input
                  id="assign-subject"
                  type="text"
                  className={`form-input ${fieldErrors.subject ? 'input-error' : ''}`}
                  placeholder="e.g. Computer Science, Mathematics"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={60}
                  required
                />
                {fieldErrors.subject && (
                  <span className="field-error-text">{fieldErrors.subject}</span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="assign-marks" className="form-label">
                  Maximum Marks <span className="required-star">*</span>
                </label>
                <input
                  id="assign-marks"
                  type="number"
                  className={`form-input ${fieldErrors.maxMarks ? 'input-error' : ''}`}
                  placeholder="100"
                  min="1"
                  max="1000"
                  value={maxMarks}
                  onChange={(e) => setMaxMarks(e.target.value)}
                  required
                />
                {fieldErrors.maxMarks && (
                  <span className="field-error-text">{fieldErrors.maxMarks}</span>
                )}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="assign-deadline" className="form-label">
                Submission Deadline <span className="required-star">*</span>
              </label>
              <input
                id="assign-deadline"
                type="datetime-local"
                className={`form-input ${fieldErrors.deadline ? 'input-error' : ''}`}
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                required
              />
              <span className="form-hint">
                Deadline must be scheduled in the future.
              </span>
              {fieldErrors.deadline && (
                <span className="field-error-text">{fieldErrors.deadline}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="assign-desc" className="form-label">
                Detailed Assignment Description & Rubric <span className="required-star">*</span>
              </label>
              <textarea
                id="assign-desc"
                className={`form-input form-textarea ${
                  fieldErrors.description ? 'input-error' : ''
                }`}
                rows="7"
                placeholder="Describe project requirements, evaluation criteria, deliverable formats, and submission guidelines..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
                required
              ></textarea>
              <div className="char-count">{description.length}/5000</div>
              {fieldErrors.description && (
                <span className="field-error-text">{fieldErrors.description}</span>
              )}
            </div>

            <div className="form-actions">
              <Link to="/teacher/assignments" className="btn btn-secondary">
                Cancel
              </Link>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
              >
                {submitting ? 'Publishing Assignment...' : 'Publish Assignment'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CreateAssignment;
