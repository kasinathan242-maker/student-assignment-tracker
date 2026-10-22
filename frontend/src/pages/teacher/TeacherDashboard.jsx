import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import DashboardCard from '../../components/DashboardCard';
import Loader from '../../components/Loader';
import EmptyState from '../../components/EmptyState';
import { formatDate } from '../../utils/deadline';

const TeacherDashboard = () => {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/dashboard/teacher');
      setMetrics(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch instructor dashboard metrics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  if (loading) {
    return <Loader message="Aggregating instructional analytics and deadlines..." />;
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="alert alert-error">
          <p>{error}</p>
          <button onClick={fetchDashboard} className="btn btn-secondary btn-sm mt-3">
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
          <h1 className="page-title">Instructor Workspace</h1>
          <p className="page-subtitle">
            Curriculum oversight, submission inboxes, and grading workflows.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/teacher/assignments/new" className="btn btn-primary">
            + Create New Assignment
          </Link>
        </div>
      </div>

      <div className="dashboard-grid">
        <DashboardCard
          title="Active Assignments"
          value={metrics?.totalAssignments || 0}
          description="Assignments authored by you"
          variant="indigo"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          }
        />

        <DashboardCard
          title="Total Submissions"
          value={metrics?.totalSubmissions || 0}
          description="Received across all coursework"
          variant="sky"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          }
        />

        <DashboardCard
          title="Pending Reviews"
          value={metrics?.pendingReviews || 0}
          description="Submissions requiring grade review"
          variant="amber"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
        />

        <DashboardCard
          title="Enrolled Students"
          value={metrics?.totalStudents || 0}
          description="Registered students in system"
          variant="emerald"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
        />
      </div>

      <div className="dashboard-section mt-6">
        <div className="section-header-flex">
          <div>
            <h2 className="section-title">Upcoming Submission Deadlines</h2>
            <p className="section-subtitle">Next 5 assignment deadlines scheduled on your calendar</p>
          </div>
          <Link to="/teacher/assignments" className="btn btn-secondary btn-sm">
            Manage All
          </Link>
        </div>

        {metrics?.upcomingDeadlines?.length === 0 ? (
          <EmptyState
            title="No Upcoming Deadlines"
            description="You do not have any future assignments scheduled. Create one to get started."
            actionText="Create Assignment"
            actionLink="/teacher/assignments/new"
          />
        ) : (
          <div className="table-card">
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Assignment Title</th>
                    <th>Subject</th>
                    <th>Deadline</th>
                    <th>Max Marks</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.upcomingDeadlines.map((assignment) => (
                    <tr key={assignment._id}>
                      <td>
                        <span className="table-primary-text">{assignment.title}</span>
                      </td>
                      <td>
                        <span className="subject-tag">{assignment.subject}</span>
                      </td>
                      <td>{formatDate(assignment.deadline)}</td>
                      <td>
                        <span className="marks-badge">{assignment.maxMarks}</span>
                      </td>
                      <td>
                        <div className="table-actions">
                          <Link
                            to={`/teacher/assignments/${assignment._id}/submissions`}
                            className="btn btn-primary btn-xs"
                          >
                            Inbox
                          </Link>
                          <Link
                            to={`/teacher/assignments/${assignment._id}/edit`}
                            className="btn btn-secondary btn-xs"
                          >
                            Edit
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeacherDashboard;
