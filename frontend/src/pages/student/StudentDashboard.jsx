import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import DashboardCard from '../../components/DashboardCard';
import Loader from '../../components/Loader';
import EmptyState from '../../components/EmptyState';

const StudentDashboard = () => {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/dashboard/student');
      setMetrics(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load dashboard metrics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  if (loading) {
    return <Loader message="Compiling your academic performance metrics..." />;
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

  if (!metrics || metrics.total === 0) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1 className="page-title">Student Dashboard</h1>
          <p className="page-subtitle">Track your assignment deadlines and course submissions.</p>
        </div>
        <EmptyState
          title="No Course Assignments Yet"
          description="Your instructors have not published any assignments for your enrolled courses."
        />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Student Dashboard</h1>
          <p className="page-subtitle">
            Overview of your current course assignments, deadlines, and grade evaluations.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/student/assignments" className="btn btn-primary">
            View All Assignments
          </Link>
        </div>
      </div>

      <div className="dashboard-grid">
        <DashboardCard
          title="Total Assignments"
          value={metrics.total}
          description="Assigned across all enrolled courses"
          variant="indigo"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          }
        />

        <DashboardCard
          title="Pending"
          value={metrics.pending}
          description="Upcoming assignments to complete"
          variant="amber"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
        />

        <DashboardCard
          title="Overdue"
          value={metrics.overdue}
          description="Past deadline with no submission"
          variant="rose"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          }
        />

        <DashboardCard
          title="Submitted"
          value={metrics.submitted + metrics.submittedLate}
          description={`${metrics.submittedLate} late submission${metrics.submittedLate === 1 ? '' : 's'}`}
          variant="sky"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          }
        />

        <DashboardCard
          title="Reviewed"
          value={metrics.reviewed}
          description="Graded by instructors"
          variant="emerald"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <polyline points="9 15 11 17 15 13" />
            </svg>
          }
        />

        <DashboardCard
          title="Average Score"
          value={`${metrics.averagePercentage}%`}
          description={
            metrics.reviewed > 0
              ? `Across ${metrics.reviewed} reviewed assignment${metrics.reviewed === 1 ? '' : 's'}`
              : 'No assignments graded yet'
          }
          variant="purple"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 20V10" />
              <path d="M12 20V4" />
              <path d="M6 20v-6" />
            </svg>
          }
        />
      </div>

      <div className="dashboard-shortcuts-section">
        <h2 className="section-title">Quick Actions</h2>
        <div className="shortcuts-grid">
          <Link to="/student/assignments" className="shortcut-card">
            <div className="shortcut-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <div className="shortcut-info">
              <h3>Browse Assignments</h3>
              <p>Filter by subject, search topics, and inspect deadlines.</p>
            </div>
          </Link>

          <Link to="/student/submissions" className="shortcut-card">
            <div className="shortcut-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
              </svg>
            </div>
            <div className="shortcut-info">
              <h3>My Submissions</h3>
              <p>Check submission links, graded marks, and teacher feedback.</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default StudentDashboard;
