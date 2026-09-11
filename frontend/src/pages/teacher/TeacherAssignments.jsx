import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext';
import { useAuth } from '../../context/AuthContext';
import { formatDate, getDeadlineInfo } from '../../utils/dateUtils';

export default function TeacherAssignments() {
  const { assignments, submissions, deleteAssignment } = useAppData();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');

  const teacherAssignments = currentUser?.role === 'admin'
    ? assignments
    : assignments.filter(
        a => !a.teacherId || a.teacherId === currentUser?.id || a.teacherId === currentUser?._id
      );

  const filteredAssignments = teacherAssignments.filter(a => {
    const query = search.toLowerCase();
    return (
      a.title.toLowerCase().includes(query) ||
      (a.courseName && a.courseName.toLowerCase().includes(query)) ||
      (a.className && a.className.toLowerCase().includes(query)) ||
      (a.subject && a.subject.toLowerCase().includes(query))
    );
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Assignments</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            View and manage coursework created for your classes.
          </p>
        </div>

        <button 
          className="btn btn-primary" 
          onClick={() => navigate('/assignments/create')}
        >
          + Create Assignment
        </button>
      </div>
      <div className="glass-card" style={{ padding: '0.85rem 1.25rem' }}>
        <input
          type="text"
          className="form-input"
          placeholder="Search assignments by title, course, or subject..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: '450px' }}
        />
      </div>
      <div className="custom-table-container">
        <table className="custom-table">
          <thead>
            <tr>
              <th>Assignment Title</th>
              <th>Course & Class</th>
              <th>Due Date</th>
              <th>Max Marks</th>
              <th>Submissions</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAssignments.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No assignments found. Click "+ Create Assignment" to add one.
                </td>
              </tr>
            ) : (
              filteredAssignments.map(asgn => {
                const assignmentSubs = submissions.filter(s => s.assignmentId === asgn.id);
                const gradedSubs = assignmentSubs.filter(s => s.status === 'graded');
                const deadline = getDeadlineInfo(asgn.dueDate);

                return (
                  <tr key={asgn.id}>
                    <td>
                      <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                        {asgn.title}
                      </p>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {asgn.subject}
                      </span>
                      {asgn.attachmentName && (
                        <div style={{ marginTop: '0.2rem' }}>
                          <span style={{ 
                            fontSize: '0.72rem', 
                            color: '#059669', 
                            fontWeight: 600, 
                            background: '#ECFDF5', 
                            border: '1px solid #A7F3D0', 
                            padding: '0.15rem 0.4rem', 
                            borderRadius: '4px' 
                          }}>
                            File: {asgn.attachmentName}
                          </span>
                        </div>
                      )}
                    </td>

                    <td>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                        {asgn.courseName}
                      </p>
                      <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
                        Class: {asgn.className}
                      </span>
                    </td>

                    <td>
                      <p style={{ fontSize: '0.85rem' }}>{formatDate(asgn.dueDate)}</p>
                      <span style={{ 
                        fontSize: '0.72rem', 
                        fontWeight: 600, 
                        color: deadline.isOverdue ? '#DC2626' : deadline.isUrgent ? '#D97706' : 'var(--text-muted)' 
                      }}>
                        {deadline.text}
                      </span>
                    </td>

                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                        {asgn.maxMarks}
                      </span>
                    </td>

                    <td>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {assignmentSubs.length}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.35rem' }}>
                        ({gradedSubs.length} graded)
                      </span>
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button 
                          className="btn btn-primary btn-sm"
                          onClick={() => navigate(`/teacher/submissions?assignmentId=${asgn.id}`)}
                        >
                          Submissions
                        </button>

                        <button 
                          className="btn btn-outline btn-sm"
                          style={{ color: '#DC2626', borderColor: '#FECACA' }}
                          onClick={() => {
                            if (window.confirm(`Delete assignment "${asgn.title}"?`)) {
                              deleteAssignment(asgn.id);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
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
