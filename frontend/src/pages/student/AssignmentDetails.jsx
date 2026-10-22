import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../services/api';
import StatusBadge from '../../components/StatusBadge';
import Loader from '../../components/Loader';
import { formatDate } from '../../utils/deadline';

const AssignmentDetails = () => {
  const { id } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [submissionLink, setSubmissionLink] = useState('');
  const [comments, setComments] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const fetchAssignment = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/assignments/${id}`);
      setAssignment(data);
      if (data.submission) {
        setSubmissionLink(data.submission.submissionLink || '');
        setComments(data.submission.comments || '');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch assignment details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignment();
  }, [id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!submissionLink || !/^https?:\/\/.+/.test(submissionLink.trim())) {
      setError('Please provide a valid submission URL starting with http:// or https://');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/submissions', {
        assignmentId: id,
        submissionLink: submissionLink.trim(),
        comments: comments.trim()
      });

      setSuccessMessage(
        assignment.submission
          ? 'Assignment resubmitted successfully!'
          : 'Assignment submitted successfully!'
      );
      await fetchAssignment();
    } catch (err) {
      setError(
        err.response?.data?.message || 'Failed to submit assignment. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <Loader message="Loading assignment..." />;
  }

  if (error && !assignment) {
    return (
      <div className="page-container">
        <div className="alert alert-error">
          <p>{error}</p>
          <Link to="/student/assignments" className="btn btn-secondary btn-sm mt-3">
            Back to Assignments
          </Link>
        </div>
      </div>
    );
  }

  if (!assignment) {
    return null;
  }

  const isPastDeadline = new Date() > new Date(assignment.deadline);
  const isReviewed = assignment.submission?.status === 'reviewed';
  const hasExistingSubmission = !!assignment.submission;

  return (
    <div className="page-container">
      <div className="breadcrumbs">
        <Link to="/student/assignments" className="breadcrumb-link">
          ← Back to Assignments
        </Link>
      </div>

      <div className="assignment-details-layout">
        <div className="assignment-main-column">
          <div className="card assignment-info-card">
            <div className="card-header-flex">
              <span className="subject-tag">{assignment.subject}</span>
              <StatusBadge status={assignment.derivedStatus} />
            </div>

            <h1 className="assignment-detail-title">{assignment.title}</h1>

            <div className="assignment-timing-banner">
              <div className="timing-col">
                <span className="timing-label">Deadline</span>
                <span className="timing-val">{formatDate(assignment.deadline)}</span>
              </div>
              <div className="timing-col">
                <span className="timing-label">Max Marks</span>
                <span className="timing-val score-highlight">{assignment.maxMarks}</span>
              </div>
              <div className="timing-col">
                <span className="timing-label">Time Status</span>
                <span
                  className={`timing-pill ${
                    isPastDeadline ? 'timing-overdue' : 'timing-normal'
                  }`}
                >
                  {assignment.remainingTime}
                </span>
              </div>
            </div>

            <div className="assignment-body-section">
              <h3 className="section-heading">Description & Instructions</h3>
              <div className="assignment-description-text">
                {assignment.description}
              </div>
            </div>

            {assignment.createdBy && (
              <div className="assignment-author-footer">
                <span>Instructor: {assignment.createdBy.name}</span>
                <span className="author-email">({assignment.createdBy.email})</span>
              </div>
            )}
          </div>

          {isReviewed && (
            <div className="card review-result-card">
              <div className="review-badge-header">
                <span className="review-tag">Instructor Evaluation Released</span>
                <span className="review-date">
                  Graded on {formatDate(assignment.submission.reviewedAt)}
                </span>
              </div>

              <div className="score-display">
                <div className="score-number">
                  <span className="earned-score">{assignment.submission.marks}</span>
                  <span className="max-score"> / {assignment.maxMarks}</span>
                </div>
                <div className="score-percentage">
                  {Math.round((assignment.submission.marks / assignment.maxMarks) * 100)}%
                </div>
              </div>

              {assignment.submission.feedback && (
                <div className="feedback-section">
                  <h4 className="feedback-title">Instructor Feedback</h4>
                  <p className="feedback-content">{assignment.submission.feedback}</p>
                </div>
              )}

              <div className="review-meta-item">
                <span className="meta-label">Submitted Work:</span>
                <a
                  href={assignment.submission.submissionLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="external-link"
                >
                  {assignment.submission.submissionLink} ↗
                </a>
              </div>
            </div>
          )}
        </div>

        <div className="assignment-side-column">
          <div className="card submission-action-card">
            <h2 className="card-title">
              {isReviewed
                ? 'Submission Status'
                : hasExistingSubmission
                ? 'Update Submission'
                : 'Submit Your Work'}
            </h2>

            {isReviewed ? (
              <div className="submission-locked-notice">
                <p>
                  This assignment has been reviewed and graded by your instructor. Further modifications or resubmissions are closed.
                </p>
                <div className="locked-link-box">
                  <span className="locked-link-label">Your Submitted Link:</span>
                  <a
                    href={assignment.submission.submissionLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="external-link text-truncate"
                  >
                    {assignment.submission.submissionLink}
                  </a>
                </div>
              </div>
            ) : (
              <>
                {isPastDeadline && (
                  <div className="alert alert-warning">
                    <strong>Late Submission Notice:</strong> The official deadline has passed. Submitting now will flag your submission as late.
                  </div>
                )}

                {hasExistingSubmission && (
                  <div className="existing-submission-info">
                    <div className="info-row">
                      <span className="info-label">Current Version:</span>
                      <span className="info-val">
                        Submitted {formatDate(assignment.submission.submittedAt)}
                      </span>
                    </div>
                    {assignment.submission.isLate && (
                      <span className="late-indicator">Flagged as Late</span>
                    )}
                  </div>
                )}

                {error && <div className="alert alert-error">{error}</div>}
                {successMessage && (
                  <div className="alert alert-success">{successMessage}</div>
                )}

                <form onSubmit={handleSubmit} className="submission-form">
                  <div className="form-group">
                    <label htmlFor="submission-link" className="form-label">
                      Submission URL <span className="required-star">*</span>
                    </label>
                    <input
                      id="submission-link"
                      type="url"
                      className="form-input"
                      placeholder="https://github.com/... or https://drive.google.com/..."
                      value={submissionLink}
                      onChange={(e) => setSubmissionLink(e.target.value)}
                      required
                    />
                    <span className="form-hint">
                      Provide a valid public URL to your repository, code artifact, or document.
                    </span>
                  </div>

                  <div className="form-group">
                    <label htmlFor="submission-comments" className="form-label">
                      Student Notes / Comments (Optional)
                    </label>
                    <textarea
                      id="submission-comments"
                      className="form-input form-textarea"
                      rows="4"
                      placeholder="Add any specific context, test instructions, or notes for the instructor..."
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      maxLength={1000}
                    ></textarea>
                    <div className="char-count">{comments.length}/1000</div>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary btn-block"
                    disabled={submitting}
                  >
                    {submitting
                      ? 'Submitting...'
                      : hasExistingSubmission
                      ? 'Update Submission (Resubmit)'
                      : 'Submit Assignment'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssignmentDetails;
