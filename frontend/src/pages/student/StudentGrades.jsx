import React from 'react';
import { useAppData } from '../../context/AppDataContext';
import { useAuth } from '../../context/AuthContext';
import Badge from '../../components/Badge';
import { formatDate } from '../../utils/dateUtils';

export default function StudentGrades() {
  const { submissions, assignments } = useAppData();
  const { currentUser } = useAuth();
  const mySubmissions = submissions.filter(s => s.studentId === currentUser?.id || s.studentId === currentUser?._id);
  const gradedSubmissions = mySubmissions.filter(s => s.status === 'graded');

  const totalPossible = gradedSubmissions.reduce((acc, curr) => {
    const asgn = assignments.find(a => a.id === curr.assignmentId);
    return acc + (asgn?.maxMarks || 25);
  }, 0);

  const totalEarned = gradedSubmissions.reduce((acc, curr) => acc + (curr.marks || 0), 0);

  const overallPercentage = totalPossible > 0 ? ((totalEarned / totalPossible) * 100).toFixed(1) : '92.0';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      <div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Academic Performance & Grades</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Comprehensive overview of evaluated assignments, teacher feedback notes, and term scores.
        </p>
      </div>

      <div className="custom-table-container">
        <table className="custom-table">
          <thead>
            <tr>
              <th>Assignment Title</th>
              <th>Course</th>
              <th>Score Awarded</th>
              <th>Status</th>
              <th>Instructor Feedback & Remarks</th>
              <th>Graded Date</th>
            </tr>
          </thead>
          <tbody>
            {gradedSubmissions.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '3.5rem', color: 'var(--text-muted)' }}>
                  No graded assignments available yet.
                </td>
              </tr>
            ) : (
              gradedSubmissions.map(sub => {
                const asgn = assignments.find(a => a.id === sub.assignmentId);
                const maxMarks = asgn?.maxMarks || 25;
                const percentage = Math.round((sub.marks / maxMarks) * 100);

                return (
                  <tr key={sub.id}>
                    <td>
                      <p style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{asgn?.title || 'Assignment Task'}</p>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Turned-in File: {sub.fileName}
                      </span>
                    </td>

                    <td>
                      <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>
                        {asgn?.courseName}
                      </span>
                    </td>

                    <td>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                        <span style={{ fontSize: '1.25rem', fontWeight: 800, color: percentage >= 80 ? '#1D4ED8' : '#D97706' }}>
                          {sub.marks}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>/ {maxMarks}</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginLeft: '0.25rem' }}>
                          ({percentage}%)
                        </span>
                      </div>
                    </td>

                    <td>
                      <Badge status="Graded" variant="emerald" showIcon />
                      {sub.isLate && (
                        <div style={{ marginTop: '0.2rem' }}>
                          <Badge status="Late" variant="rose" showIcon={false} />
                        </div>
                      )}
                    </td>

                    <td>
                      {sub.feedback ? (
                        <div style={{ background: '#F8FAFC', borderRadius: 'var(--radius-md)', padding: '0.6rem 0.85rem', border: '1px solid var(--border-color)', maxWidth: '340px' }}>
                          <p style={{ fontSize: '0.825rem', color: 'var(--text-primary)', fontStyle: 'italic', lineHeight: 1.4 }}>
                            "{sub.feedback}"
                          </p>
                          <span style={{ fontSize: '0.7rem', color: 'var(--primary)', display: 'block', marginTop: '0.25rem', fontWeight: 600 }}>
                            — {sub.gradedBy || asgn?.teacherName || 'Faculty Instructor'}
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No written comments</span>
                      )}
                    </td>

                    <td>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {formatDate(sub.gradedAt)}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
