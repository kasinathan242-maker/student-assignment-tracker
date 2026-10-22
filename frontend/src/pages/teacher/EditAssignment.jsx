import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../services/api';
import Loader from '../../components/Loader';
import { toInputDateTime } from '../../utils/deadline';

const EditAssignment = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [deadline, setDeadline] = useState('');
  const [maxMarks, setMaxMarks] = useState(100);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    const fetchAssignment = async () => {
      setLoading(true);
      setError('');
      try {
        const { data } = await api.get(`/assignments/${id}`);
        setTitle(data.title || '');
        setDescription(data.description || '');
        setSubject(data.subject || '');
        setMaxMarks(data.maxMarks || 100);
        setDeadline(toInputDateTime(data.deadline));
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load assignment.');
      } finally {
        setLoading(false);
      }
    };

    fetchAssignment();
  }, [id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    const errors = {};
    if (!title.trim()) errors.title = 'Title is required';
    if (!subject.trim()) errors.subject = 'Subject is required';
    if (!description.trim()) errors.description = 'Description is required';
    if (!deadline) errors.deadline = 'Deadline is required';

    const marksNum = Number(maxMarks);
    if (isNaN(marksNum) || marksNum < 1 || marksNum > 1000) {
      errors.maxMarks = 'Max marks must be between 1 and 1000';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await api.put(`/assignments/${id}`, {
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
          err.response?.data?.message || 'Failed to update assignment. Please try again.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <Loader message="Loading assignment for editing..." />;
  }

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
            <h1 className="form-card-title">Edit Assignment</h1>
            <p className="form-card-subtitle">
              Modify course details, adjust deadlines, or update evaluation point scales.
            </p>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit} className="standard-form" noValidate>
            <div className="form-group">
              <label htmlFor="edit-title" className="form-label">
                Assignment Title <span className="required-star">*</span>
              </label>
              <input
                id="edit-title"
                type="text"
                className={`form-input ${fieldErrors.title ? 'input-error' : ''}`}
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
                <label htmlFor="edit-subject" className="form-label">
                  Subject / Course Domain <span className="required-star">*</span>
                </label>
                <input
                  id="edit-subject"
                  type="text"
                  className={`form-input ${fieldErrors.subject ? 'input-error' : ''}`}
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
                <label htmlFor="edit-marks" className="form-label">
                  Maximum Marks <span className="required-star">*</span>
                </label>
                <input
                  id="edit-marks"
                  type="number"
                  className={`form-input ${fieldErrors.maxMarks ? 'input-error' : ''}`}
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
              <label htmlFor="edit-deadline" className="form-label">
                Submission Deadline <span className="required-star">*</span>
              </label>
              <input
                id="edit-deadline"
                type="datetime-local"
                className={`form-input ${fieldErrors.deadline ? 'input-error' : ''}`}
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                required
              />
              {fieldErrors.deadline && (
                <span className="field-error-text">{fieldErrors.deadline}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="edit-desc" className="form-label">
                Detailed Assignment Description & Rubric <span className="required-star">*</span>
              </label>
              <textarea
                id="edit-desc"
                className={`form-input form-textarea ${
                  fieldErrors.description ? 'input-error' : ''
                }`}
                rows="7"
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
                {submitting ? 'Saving Changes...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EditAssignment;
