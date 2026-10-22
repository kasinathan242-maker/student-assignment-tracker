import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../services/api';
import StatusBadge from '../../components/StatusBadge';
import Loader from '../../components/Loader';
import EmptyState from '../../components/EmptyState';
import { formatDate } from '../../utils/deadline';

const Submissions = () => {
  const { id } = useParams();

  const [assignment, setAssignment] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [notSubmittedStudents, setNotSubmittedStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Active review drawer / inline modal state
  const [reviewingSubmission, setReviewingSubmission] = useState(null);
  const [reviewMarks, setReviewMarks] = useState('');
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const fetchSubmissionsData = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/submissions/assignment/${id}`);
      setAssignment(data.assignment);
      setSubmissions(data.submissions);
      setNotSubmittedStudents(data.notSubmittedStudents);
    } catch (err) {
      setError(
        err.response?.data?.message || 'Failed to load assignment submission inbox.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubmissionsData();
  }, [id]);

  const handleOpenReview = (submission) => {
    setReviewingSubmission(submission);
    setReviewMarks(submission.marks !== undefined && submission.marks !== null ? submission.marks : '');
    setReviewFeedback(submission.feedback || '');
    setReviewError('');
  };

  const handleCloseReview = () => {
    setReviewingSubmission(null);
    setReviewMarks('');
    setReviewFeedback('');
    setReviewError('');
  };

  const handleSaveReview = async (e) => {
    e.preventDefault();
    setReviewError('');
    setActionSuccess('');

    const marksNum = Number(reviewMarks);
    if (reviewMarks === '' || isNaN(marksNum)) {
      setReviewError('Please enter a valid numeric mark.');
      return;
    }

    if (marksNum < 0 || marksNum > assignment.maxMarks) {
      setReviewError(`Marks must be between 0 and ${assignment.maxMarks}.`);
      return;
    }

    setReviewSubmitting(true);
    try {
      await api.put(`/submissions/${reviewingSubmission._id}/review`, {
        marks: marksNum,
        feedback: reviewFeedback.trim()
      });

      setActionSuccess(`Evaluation saved for ${reviewingSubmission.studentId?.name || 'student'}.`);
      handleCloseReview();
      await fetchSubmissionsData();
    } catch (err) {
      setReviewError(
        err.response?.data?.message || 'Failed to submit review. Please try again.'
      );
    } finally {
      setReviewSubmitting(false);
    }
  };

  if (loading) {
    return <Loader message="Fetching assignment submissions and student rosters..." />;
  }

  if (error && !assignment) {
    return (
      <div className="page-container">
        <div className="alert alert-error">
          <p>{error}</p>
          <Link to="/teacher/assignments" className="btn btn-secondary btn-sm mt-3">
            Back to Manage Assignments
          </Link>
        </div>
      </div>
    );
  }

  const reviewedCount = submissions.filter((s) => s.status === 'reviewed').length;
  const pendingCount = submissions.filter((s) => s.status === 'submitted').length;

  return (
    <div className="page-container">
      <div className="breadcrumbs">
        <Link to="/teacher/assignments" className="breadcrumb-link">
          ← Back to Manage Assignments
        </Link>
      </div>

      {actionSuccess && (
        <div className="alert alert-success mb-4">{actionSuccess}</div>
      )}
      {error && <div className="alert alert-error mb-4">{error}</div>}

      <div className="assignment-inbox-header">
        <div className="inbox-title-area">
          <span className="subject-tag">{assignment?.subject}</span>
          <h1 className="page-title">{assignment?.title}</h1>
          <p className="inbox-deadline">
            Deadline: <strong>{formatDate(assignment?.deadline)}</strong> | Max Marks: <strong>{assignment?.maxMarks}</strong>
          </p>
        </div>

        <div className="inbox-stats-pills">
          <div className="stat-pill">
            <span className="stat-pill-label">Total Submissions</span>
            <span className="stat-pill-value">{submissions.length}</span>
          </div>
          <div className="stat-pill">
            <span className="stat-pill-label">Awaiting Review</span>
            <span className="stat-pill-value text-amber">{pendingCount}</span>
          </div>
          <div className="stat-pill">
            <span className="stat-pill-label">Evaluated</span>
            <span className="stat-pill-value text-emerald">{reviewedCount}</span>
          </div>
          <div className="stat-pill">
            <span className="stat-pill-label">Not Submitted</span>
            <span className="stat-pill-value text-rose">{notSubmittedStudents.length}</span>
          </div>
        </div>
      </div>

      <div className="inbox-section">
        <h2 className="section-title">Received Submissions ({submissions.length})</h2>

        {submissions.length === 0 ? (
          <EmptyState
            title="No Submissions Received Yet"
            description="Students enrolled in this course have not submitted any assignments for this task."
          />
        ) : (
          <div className="table-card">
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Submission URL</th>
                    <th>Submitted Time</th>
                    <th>Timing</th>
                    <th>Status</th>
                    <th>Marks</th>
                    <th>Feedback</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((sub) => {
                    const isReviewed = sub.status === 'reviewed';

                    return (
                      <tr key={sub._id}>
                        <td>
                          <div className="student-cell">
                            <span className="table-primary-text">
                              {sub.studentId?.name || 'Unknown Student'}
                            </span>
                            <span className="student-email">
                              {sub.studentId?.email || '-'}
                            </span>
                          </div>
                        </td>
                        <td>
                          <a
                            href={sub.submissionLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-outline btn-xs external-btn"
                          >
                            Open Link ↗
                          </a>
                        </td>
                        <td>{formatDate(sub.submittedAt)}</td>
                        <td>
                          {sub.isLate ? (
                            <span className="late-indicator">Late</span>
                          ) : (
                            <span className="on-time-indicator">On Time</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={isReviewed ? 'reviewed' : 'submitted'} />
                        </td>
                        <td>
                          {isReviewed ? (
                            <span className="marks-badge">
                              {sub.marks} / {assignment.maxMarks}
                            </span>
                          ) : (
                            <span className="pending-text">Ungraded</span>
                          )}
                        </td>
                        <td>
                          <div className="feedback-cell">
                            {sub.feedback ? (
                              <span className="feedback-preview" title={sub.feedback}>
                                {sub.feedback}
                              </span>
                            ) : (
                              <span className="pending-text">-</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => handleOpenReview(sub)}
                            className={`btn btn-xs ${
                              isReviewed ? 'btn-secondary' : 'btn-primary'
                            }`}
                          >
                            {isReviewed ? 'Edit Grade' : 'Grade & Review'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="inbox-section mt-8">
        <h2 className="section-title">
          Students Not Yet Submitted ({notSubmittedStudents.length})
        </h2>
        <p className="section-subtitle">
          Enrolled students who have not turned in any work for this assignment.
        </p>

        {notSubmittedStudents.length === 0 ? (
          <div className="alert alert-success">
            All registered students have submitted work for this assignment.
          </div>
        ) : (
          <div className="table-card">
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Email Address</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {notSubmittedStudents.map((st) => (
                    <tr key={st._id}>
                      <td>
                        <span className="table-primary-text">{st.name}</span>
                      </td>
                      <td>
                        <span className="student-email">{st.email}</span>
                      </td>
                      <td>
                        <span className="timing-pill timing-overdue">Unsubmitted</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Review & Grading Modal */}
      {reviewingSubmission && (
        <div className="modal-overlay">
          <div className="modal-dialog modal-dialog-lg">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">
                  Grade Submission: {reviewingSubmission.studentId?.name}
                </h3>
                <span className="modal-subtitle">
                  {reviewingSubmission.studentId?.email}
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={handleCloseReview}
              >
                ✕
              </button>
            </div>

            {reviewError && (
              <div className="alert alert-error mb-4">{reviewError}</div>
            )}

            <form onSubmit={handleSaveReview} className="standard-form">
              <div className="review-meta-box">
                <div className="meta-box-row">
                  <span className="label">Submission URL:</span>
                  <a
                    href={reviewingSubmission.submissionLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="external-link"
                  >
                    {reviewingSubmission.submissionLink} ↗
                  </a>
                </div>
                <div className="meta-box-row">
                  <span className="label">Submitted At:</span>
                  <span>{formatDate(reviewingSubmission.submittedAt)}</span>
                  {reviewingSubmission.isLate && (
                    <span className="late-indicator ml-2">Late Submission</span>
                  )}
                </div>
                {reviewingSubmission.comments && (
                  <div className="meta-box-row">
                    <span className="label">Student Notes:</span>
                    <p className="student-notes-box">
                      {reviewingSubmission.comments}
                    </p>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="review-marks" className="form-label">
                  Marks Awarded (Max: {assignment.maxMarks}) <span className="required-star">*</span>
                </label>
                <input
                  id="review-marks"
                  type="number"
                  className="form-input"
                  min="0"
                  max={assignment.maxMarks}
                  placeholder={`0 - ${assignment.maxMarks}`}
                  value={reviewMarks}
                  onChange={(e) => setReviewMarks(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="review-feedback" className="form-label">
                  Instructor Feedback & Rubric Notes
                </label>
                <textarea
                  id="review-feedback"
                  className="form-input form-textarea"
                  rows="5"
                  placeholder="Provide qualitative feedback, code review remarks, and rubric scoring breakdown..."
                  value={reviewFeedback}
                  onChange={(e) => setReviewFeedback(e.target.value)}
                  maxLength={2000}
                ></textarea>
                <div className="char-count">{reviewFeedback.length}/2000</div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCloseReview}
                  disabled={reviewSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={reviewSubmitting}
                >
                  {reviewSubmitting ? 'Saving Review...' : 'Save Grade & Feedback'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Submissions;
