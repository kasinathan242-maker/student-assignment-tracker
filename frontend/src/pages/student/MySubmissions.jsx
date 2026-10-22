import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import StatusBadge from '../../components/StatusBadge';
import Loader from '../../components/Loader';
import EmptyState from '../../components/EmptyState';
import { formatDate } from '../../utils/deadline';

const MySubmissions = () => {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSubmissions = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/submissions/my');
      setSubmissions(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to retrieve your submissions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubmissions();
  }, []);

  if (loading) {
    return <Loader message="Loading your submission history..." />;
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="alert alert-error">
          <p>{error}</p>
          <button onClick={fetchSubmissions} className="btn btn-secondary btn-sm mt-3">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1 className="page-title">My Submissions</h1>
          <p className="page-subtitle">Track your submitted work and instructor feedback.</p>
        </div>
        <EmptyState
          title="No Submissions Yet"
          description="You have not submitted work for any assignments yet. Browse assignments to get started."
          actionText="Browse Assignments"
          actionLink="/student/assignments"
        />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Submissions</h1>
          <p className="page-subtitle">
            Comprehensive audit of all coursework submitted, timing flags, and marks awarded.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/student/assignments" className="btn btn-secondary btn-sm">
            Browse Assignments
          </Link>
        </div>
      </div>

      <div className="table-card">
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Assignment</th>
                <th>Subject</th>
                <th>Submitted Date</th>
                <th>Timing</th>
                <th>Status</th>
                <th>Marks Earned</th>
                <th>Instructor Feedback</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((sub) => {
                const assignment = sub.assignmentId;
                const isReviewed = sub.status === 'reviewed';

                return (
                  <tr key={sub._id}>
                    <td>
                      <div className="table-title-cell">
                        <span className="table-primary-text">
                          {assignment?.title || 'Unknown Assignment'}
                        </span>
                        <a
                          href={sub.submissionLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="table-sub-link"
                        >
                          View Link ↗
                        </a>
                      </div>
                    </td>
                    <td>
                      <span className="subject-tag">{assignment?.subject || '-'}</span>
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
                          <strong>{sub.marks}</strong> / {assignment?.maxMarks || 100}
                        </span>
                      ) : (
                        <span className="pending-text">Awaiting Review</span>
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
                      {assignment?._id ? (
                        <Link
                          to={`/student/assignments/${assignment._id}`}
                          className="btn btn-secondary btn-xs"
                        >
                          View
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default MySubmissions;
