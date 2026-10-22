import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import Loader from '../../components/Loader';
import EmptyState from '../../components/EmptyState';
import { formatDate } from '../../utils/deadline';

const ManageAssignments = () => {
  const [assignments, setAssignments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const fetchAssignments = async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/assignments?page=${page}&limit=10&sort=-createdAt`);
      setAssignments(data.assignments);
      setPagination(data.pagination);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to retrieve your assignments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignments(1);
  }, []);

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await api.delete(`/assignments/${id}`);
      setConfirmDeleteId(null);
      await fetchAssignments(pagination.page);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete assignment.');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return <Loader message="Loading your published assignments..." />;
  }

  if (error && assignments.length === 0) {
    return (
      <div className="page-container">
        <div className="alert alert-error">
          <p>{error}</p>
          <button onClick={() => fetchAssignments(1)} className="btn btn-secondary btn-sm mt-3">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Manage Course Assignments</h1>
          <p className="page-subtitle">
            Create, update, monitor student submissions, and manage course evaluations.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/teacher/assignments/new" className="btn btn-primary">
            + Create New Assignment
          </Link>
        </div>
      </div>

      {error && <div className="alert alert-error mb-4">{error}</div>}

      {assignments.length === 0 ? (
        <EmptyState
          title="No Published Assignments"
          description="You haven't created any course assignments yet. Start by publishing your first assignment."
          actionText="Create Assignment"
          actionLink="/teacher/assignments/new"
        />
      ) : (
        <>
          <div className="table-card">
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Subject</th>
                    <th>Deadline</th>
                    <th>Max Marks</th>
                    <th>Submissions</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((assignment) => (
                    <tr key={assignment._id}>
                      <td>
                        <div className="table-title-cell">
                          <span className="table-primary-text">{assignment.title}</span>
                          <span className="table-sub-text">
                            {assignment.remainingTime}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="subject-tag">{assignment.subject}</span>
                      </td>
                      <td>{formatDate(assignment.deadline)}</td>
                      <td>
                        <span className="marks-badge">{assignment.maxMarks}</span>
                      </td>
                      <td>
                        <Link
                          to={`/teacher/assignments/${assignment._id}/submissions`}
                          className="submission-count-badge"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span>{assignment.submissionCount || 0} received</span>
                        </Link>
                      </td>
                      <td>
                        <div className="table-actions">
                          <Link
                            to={`/teacher/assignments/${assignment._id}/submissions`}
                            className="btn btn-primary btn-xs"
                            title="View Submissions & Grade"
                          >
                            Inbox
                          </Link>
                          <Link
                            to={`/teacher/assignments/${assignment._id}/edit`}
                            className="btn btn-secondary btn-xs"
                            title="Edit Assignment"
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(assignment._id)}
                            className="btn btn-danger-outline btn-xs"
                            title="Delete Assignment"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {pagination.pages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-secondary btn-sm pagination-btn"
                disabled={pagination.page <= 1}
                onClick={() => fetchAssignments(pagination.page - 1)}
              >
                Previous
              </button>
              <span className="pagination-info">
                Page {pagination.page} of {pagination.pages} ({pagination.total} assignments)
              </span>
              <button
                className="btn btn-secondary btn-sm pagination-btn"
                disabled={pagination.page >= pagination.pages}
                onClick={() => fetchAssignments(pagination.page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Confirmation Modal for Delete */}
      {confirmDeleteId && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <h3 className="modal-title">Delete Assignment</h3>
            <p className="modal-body">
              Are you sure you want to permanently delete this assignment? All associated student submissions and evaluation records will also be erased. This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmDeleteId(null)}
                disabled={deletingId === confirmDeleteId}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deletingId === confirmDeleteId}
              >
                {deletingId === confirmDeleteId ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageAssignments;
