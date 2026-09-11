import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext';
import { useAuth } from '../../context/AuthContext';
import StatCard from '../../components/StatCard';
import Badge from '../../components/Badge';
import GradeModal from '../../components/GradeModal';
import { getDeadlineInfo, formatDateTime, formatDate } from '../../utils/dateUtils';

export default function TeacherDashboard() {
  const { currentUser, users } = useAuth();
  const { assignments, submissions, classes } = useAppData();
  const navigate = useNavigate();

  const [gradingSubmission, setGradingSubmission] = useState(null);
  const [selectedAssignment, setSelectedAssignment] = useState(null);

  const teacherAssignments = assignments.filter(
    a => !a.teacherId || a.teacherId === currentUser?.id || a.teacherId === currentUser?._id
  );

  const assignmentIds = teacherAssignments.map(a => a.id || a._id);
  const teacherSubmissions = submissions.filter(s => assignmentIds.includes(s.assignmentId));

  const pendingGrading = teacherSubmissions.filter(s => s.status === 'submitted');
  const gradedCount = teacherSubmissions.filter(s => s.status === 'graded').length;
  const lateCount = teacherSubmissions.filter(s => s.isLate).length;

  const totalClassStudents = users.filter(u => u.role === 'student').length;

  const upcomingAssignments = [...teacherAssignments]
    .filter(a => new Date(a.dueDate).getTime() > Date.now())
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    .slice(0, 3);

  const handleOpenGrade = (sub) => {
    const parentAssignment = assignments.find(a => a.id === sub.assignmentId);
    setSelectedAssignment(parentAssignment);
    setGradingSubmission(sub);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>
            Faculty Dashboard
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Welcome back, {currentUser?.name || 'Mohan Kasinathan'} • {currentUser?.department || 'Department of Computer Science'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            className="btn btn-secondary" 
            onClick={() => navigate('/submissions')}
          >
            Evaluate Submissions
          </button>
          <button 
            className="btn btn-primary" 
            onClick={() => navigate('/assignments/create')}
          >
            + Create Assignment
          </button>
        </div>
      </div>

      <div className="stat-card-grid">
        <StatCard
          title="Total Assignments"
          value={teacherAssignments.length}
          subtext="Active in your courses"
        />
        <StatCard
          title="Total Students"
          value={totalClassStudents}
          subtext="Across assigned class batches"
        />
        <StatCard
          title="Pending Grading"
          value={pendingGrading.length}
          subtext="Requires your evaluation"
        />
        <StatCard
          title="Late Submissions"
          value={lateCount}
          subtext="Submitted past deadline"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1.1rem' }}>Upcoming Assignment Deadlines</h3>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/teacher/assignments')}>
              View All
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {upcomingAssignments.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem 0' }}>
                No assignments currently scheduled.
              </p>
            ) : (
              upcomingAssignments.map(item => {
                const deadlineInfo = getDeadlineInfo(item.dueDate);
                return (
                  <div
                    key={item.id}
                    style={{
                      padding: '1rem',
                      background: '#F8FAFC',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <h4 style={{ fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                        {item.title}
                      </h4>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {item.courseName} • Class {item.className}
                      </p>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <Badge 
                        status={deadlineInfo.text} 
                        variant={deadlineInfo.badgeVariant} 
                      />
                      <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                        {formatDate(item.dueDate)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1.1rem' }}>Submissions Awaiting Grading</h3>
            <span style={{ fontSize: '0.8rem', color: '#D97706', fontWeight: 700 }}>
              {pendingGrading.length} Pending
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {pendingGrading.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>All submissions evaluated!</p>
                <p style={{ fontSize: '0.78rem' }}>Great job keeping up with student feedback.</p>
              </div>
            ) : (
              pendingGrading.slice(0, 4).map(sub => {
                const asgn = assignments.find(a => a.id === sub.assignmentId);
                return (
                  <div
                    key={sub.id}
                    style={{
                      padding: '0.85rem 1rem',
                      background: '#F8FAFC',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <p style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {sub.studentName}
                      </p>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {asgn?.title}
                      </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      {sub.isLate && <Badge status="Late" variant="rose" />}
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleOpenGrade(sub)}
                      >
                        Grade Now
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      {gradingSubmission && selectedAssignment && (
        <GradeModal
          isOpen={!!gradingSubmission}
          onClose={() => setGradingSubmission(null)}
          submission={gradingSubmission}
          assignment={selectedAssignment}
        />
      )}
    </div>
  );
}
