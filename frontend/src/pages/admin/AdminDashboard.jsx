import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext';
import { useAuth } from '../../context/AuthContext';
import StatCard from '../../components/StatCard';
import Badge from '../../components/Badge';
import GradeModal from '../../components/GradeModal';
import { formatDate } from '../../utils/dateUtils';

export default function AdminDashboard() {
  const { currentUser, users } = useAuth();
  const { assignments, submissions, deleteAssignment, updateAssignment } = useAppData();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('assignments');
  const [gradingSubmission, setGradingSubmission] = useState(null);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [editFormData, setEditFormData] = useState({ title: '', dueDate: '', maxMarks: 25, teacherName: '', courseName: '' });

  const totalStudents = users.filter(u => u.role === 'student').length;
  const totalFaculty = users.filter(u => u.role === 'teacher').length;
  const totalAssignments = assignments.length;
  const totalSubmissions = submissions.length;
  const gradedSubmissions = submissions.filter(s => s.status === 'graded');
  const evaluatedPercentage = totalSubmissions > 0 ? Math.round((gradedSubmissions.length / totalSubmissions) * 100) : 0;
  
  const avgMarks = gradedSubmissions.length > 0 
    ? (gradedSubmissions.reduce((acc, curr) => acc + (Number(curr.marks) || 0), 0) / gradedSubmissions.length).toFixed(1)
    : '0';

  const handleOpenGrade = (sub) => {
    const parentAssignment = assignments.find(a => a.id === sub.assignmentId || a._id === sub.assignmentId);
    setSelectedAssignment(parentAssignment || { title: 'Assignment', maxMarks: 25 });
    setGradingSubmission(sub);
  };

  const handleDownload = (sub) => {
    const parentAssignment = assignments.find(a => a.id === sub.assignmentId || a._id === sub.assignmentId);
    const fileName = sub.fileName || `${(sub.studentName || 'student').toLowerCase().replace(/\s+/g, '_')}_submission.pdf`;
    if (sub.fileUrl && sub.fileUrl !== '#') {
      const link = document.createElement('a');
      link.href = sub.fileUrl;
      link.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const pdfContent = `%PDF-1.4\n% Student Assignment Submission\nStudent: ${sub.studentName}\nAssignment: ${parentAssignment?.title || 'Assignment'}\nSubmitted: ${sub.submittedAt || new Date().toISOString()}\n`;
      const blob = new Blob([pdfContent], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  const handleStartEdit = (asgn) => {
    setEditingAssignment(asgn);
    setEditFormData({
      title: asgn.title || '',
      dueDate: asgn.dueDate ? new Date(asgn.dueDate).toISOString().split('T')[0] : '',
      maxMarks: asgn.maxMarks || 25,
      teacherName: asgn.teacherName || 'Faculty',
      courseName: asgn.courseName || 'Computer Science'
    });
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    if (!editingAssignment) return;
    const asgnId = editingAssignment.id || editingAssignment._id;
    updateAssignment(asgnId, editFormData);
    setEditingAssignment(null);
  };

  const handleDeleteAssignment = (id, title) => {
    if (window.confirm(`Are you sure you want to delete assignment "${title}"? This will remove associated submissions.`)) {
      deleteAssignment(id);
    }
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-banner-admin">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.25rem' }}>
          <div>
            <div className="dashboard-banner-admin-tag">
              Head of Department (HOD) Master Portal
            </div>
            <h1 className="dashboard-banner-title">
              Welcome back, {currentUser?.name || 'Dr. Mohan (HOD)'}
            </h1>
            <p className="dashboard-banner-subtitle">
              {currentUser?.department || 'Department of Computer Science & Engineering'} • Full Academic Superuser Privileges
            </p>
          </div>

          <div className="dashboard-actions">
            <button
              className="btn btn-secondary"
              onClick={() => navigate('/assignments/create')}
              style={{ background: '#FFFFFF', color: '#6D28D9', fontWeight: 700, border: 'none' }}
            >
              + Create Assignment
            </button>
            <button
              className="btn btn-outline"
              onClick={() => navigate('/student/assignments')}
              style={{ color: '#FFFFFF', borderColor: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.1)' }}
            >
              Student View
            </button>
            <button
              className="btn btn-outline"
              onClick={() => navigate('/teacher/dashboard')}
              style={{ color: '#FFFFFF', borderColor: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.1)' }}
            >
              Teacher View
            </button>
          </div>
        </div>
      </div>
      <div className="stat-card-grid">
        <StatCard
          title="Total Students"
          value={totalStudents}
          subtext="Enrolled in Department"
        />
        <StatCard
          title="Total Faculty"
          value={totalFaculty}
          subtext="Active Teachers & Instructors"
        />
        <StatCard
          title="All Assignments"
          value={totalAssignments}
          subtext="Active Across All Batches"
        />
        <StatCard
          title="Total Submissions"
          value={totalSubmissions}
          subtext={`${evaluatedPercentage}% Evaluated`}
        />
        <StatCard
          title="Class Average"
          value={`${avgMarks} / 25`}
          subtext="Based on graded work"
        />
      </div>
      <div className="tab-nav">
        <button
          className={`tab-btn ${activeTab === 'assignments' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('assignments')}
        >
          Master Assignments ({assignments.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'submissions' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('submissions')}
        >
          All Student Submissions & Grades ({submissions.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'users' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          Department Users ({users.length})
        </button>
      </div>
      {activeTab === 'assignments' && (
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Master Assignment Records</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                HODs have full access to view, edit, and delete any coursework created by faculty.
              </p>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate('/assignments/create')}
            >
              + Create New Assignment
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Assignment Title</th>
                  <th>Faculty / Teacher</th>
                  <th>Course / Department</th>
                  <th>Due Date</th>
                  <th>Max Marks</th>
                  <th>Submissions</th>
                  <th style={{ textAlign: 'right' }}>HOD Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignments.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                      No assignments found in system.
                    </td>
                  </tr>
                ) : (
                  assignments.map(asgn => {
                    const asgnId = asgn.id || asgn._id;
                    const asgnSubs = submissions.filter(s => s.assignmentId === asgnId);
                    return (
                      <tr key={asgnId}>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {asgn.title}
                        </td>
                        <td style={{ color: 'var(--text-secondary)' }}>
                          {asgn.teacherName || 'Faculty'}
                        </td>
                        <td>
                          <span style={{ fontSize: '0.8rem', background: '#F1F5F9', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                            {asgn.courseName || 'Computer Science'}
                          </span>
                        </td>
                        <td>{formatDate(asgn.dueDate)}</td>
                        <td style={{ fontWeight: 700, color: 'var(--primary)' }}>
                          {asgn.maxMarks || 25} pts
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{asgnSubs.length}</span> received
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleStartEdit(asgn)}
                              style={{ fontSize: '0.78rem', padding: '0.25rem 0.55rem' }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => handleDeleteAssignment(asgnId, asgn.title)}
                              style={{ fontSize: '0.78rem', padding: '0.25rem 0.55rem' }}
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
      )}

      {/* Tab 2: All Student Submissions & Grading */}
      {activeTab === 'submissions' && (
        <div className="glass-card">
          <div style={{ marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Master Student Submissions & Grading</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              View submitted PDF work, download student files, and evaluate or override grades.
            </p>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student Name</th>
                  <th>Assignment</th>
                  <th>File / Solution</th>
                  <th>Submitted At</th>
                  <th>Status</th>
                  <th>Marks (/ 25)</th>
                  <th style={{ textAlign: 'right' }}>Evaluation</th>
                </tr>
              </thead>
              <tbody>
                {submissions.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                      No student submissions recorded yet.
                    </td>
                  </tr>
                ) : (
                  submissions.map(sub => {
                    const asgn = assignments.find(a => a.id === sub.assignmentId || a._id === sub.assignmentId);
                    return (
                      <tr key={sub.id || sub._id}>
                        <td>
                          <p style={{ fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                            {sub.studentName || 'Student'}
                          </p>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {sub.studentEmail}
                          </span>
                        </td>
                        <td>{asgn?.title || 'Assignment'}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleDownload(sub)}
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                          >
                            Download
                          </button>
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>{formatDate(sub.submittedAt)}</td>
                        <td>
                          <Badge
                            status={sub.status === 'graded' ? 'Graded' : 'Submitted'}
                            variant={sub.status === 'graded' ? 'emerald' : 'amber'}
                          />
                        </td>
                        <td style={{ fontWeight: 700, fontSize: '0.95rem', color: sub.status === 'graded' ? '#059669' : 'var(--text-muted)' }}>
                          {sub.status === 'graded' && typeof sub.marks === 'number' ? `${sub.marks} / 25` : 'Pending'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className={`btn btn-sm ${sub.status === 'graded' ? 'btn-secondary' : 'btn-primary'}`}
                            onClick={() => handleOpenGrade(sub)}
                            style={{ fontSize: '0.78rem', padding: '0.25rem 0.65rem' }}
                          >
                            {sub.status === 'graded' ? 'Edit Grade' : 'Grade'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {activeTab === 'users' && (
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Department User Directory</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                All registered Students, Faculty Teachers, and Administrators in MongoDB.
              </p>
            </div>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => navigate('/register')}
            >
              + Register New User
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>Joined Date</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id || u._id}>
                    <td>
                      <p style={{ fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>{u.name}</p>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{u.email}</span>
                    </td>
                    <td>
                      <span style={{
                        textTransform: 'capitalize',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '9999px',
                        background: u.role === 'admin' ? '#EDE9FE' : (u.role === 'teacher' ? '#EFF6FF' : '#ECFDF5'),
                        color: u.role === 'admin' ? '#6D28D9' : (u.role === 'teacher' ? '#1D4ED8' : '#047857')
                      }}>
                        {u.role === 'admin' ? 'HOD Admin' : (u.role === 'teacher' ? 'Teacher' : 'Student')}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      {u.department || 'Computer Science'}
                    </td>
                    <td>
                      <Badge status="Active" variant="emerald" />
                    </td>
                    <td style={{ fontSize: '0.825rem', color: 'var(--text-muted)' }}>
                      {u.createdAt ? formatDate(u.createdAt) : 'Registered'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {editingAssignment && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h3 className="modal-title">Edit Assignment (HOD Override)</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setEditingAssignment(null)}
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSaveEdit}>
              <div className="form-group">
                <label className="form-label">Assignment Title</label>
                <input
                  type="text"
                  className="form-input"
                  value={editFormData.title}
                  onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Faculty / Teacher Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={editFormData.teacherName}
                  onChange={(e) => setEditFormData({ ...editFormData, teacherName: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Due Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={editFormData.dueDate}
                    onChange={(e) => setEditFormData({ ...editFormData, dueDate: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Max Marks</label>
                  <input
                    type="number"
                    className="form-input"
                    value={editFormData.maxMarks}
                    onChange={(e) => setEditFormData({ ...editFormData, maxMarks: Number(e.target.value) })}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingAssignment(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {gradingSubmission && (
        <GradeModal
          submission={gradingSubmission}
          assignment={selectedAssignment}
          onClose={() => setGradingSubmission(null)}
        />
      )}
    </div>
  );
}
