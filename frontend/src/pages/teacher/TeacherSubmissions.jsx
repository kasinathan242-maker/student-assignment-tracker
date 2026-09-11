import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext';
import { useAuth } from '../../context/AuthContext';
import Badge from '../../components/Badge';
import GradeModal from '../../components/GradeModal';
import { formatDate } from '../../utils/dateUtils';

export default function TeacherSubmissions() {
  const [searchParams] = useSearchParams();
  const initialAssignmentId = searchParams.get('assignmentId') || 'all';

  const { assignments, submissions } = useAppData();
  const { currentUser } = useAuth();

  const [selectedAssignmentId, setSelectedAssignmentId] = useState(initialAssignmentId);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [activeSubmission, setActiveSubmission] = useState(null);
  const [activeAssignment, setActiveAssignment] = useState(null);

  const teacherAssignments = assignments.filter(
    a => !a.teacherId || a.teacherId === currentUser?.id
  );

  const teacherAssignmentIds = teacherAssignments.map(a => a.id);

  const filteredSubmissions = submissions.filter(sub => {
    if (!teacherAssignmentIds.includes(sub.assignmentId)) return false;

    if (selectedAssignmentId !== 'all' && sub.assignmentId !== selectedAssignmentId) {
      return false;
    }

    if (statusFilter === 'submitted' && sub.status !== 'submitted') return false;
    if (statusFilter === 'graded' && sub.status !== 'graded') return false;
    if (statusFilter === 'late' && !sub.isLate) return false;

    const parentAssignment = assignments.find(a => a.id === sub.assignmentId);
    const assignmentTitle = parentAssignment?.title || '';

    const matchesSearch = 
      sub.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.rollNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      assignmentTitle.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSearch;
  });

  const handleOpenGrade = (sub) => {
    const parentAssignment = assignments.find(a => a.id === sub.assignmentId || a._id === sub.assignmentId);
    setActiveAssignment(parentAssignment || { title: 'Assignment', maxMarks: 25 });
    setActiveSubmission(sub);
  };

  const handleDownload = (sub) => {
    const parentAssignment = assignments.find(a => a.id === sub.assignmentId || a._id === sub.assignmentId);
    const fileName = sub.fileName || `${(sub.studentName || 'student').toLowerCase().replace(/\s+/g, '_')}_submission.pdf`;
    if (sub.fileUrl) {
      const link = document.createElement('a');
      link.href = sub.fileUrl;
      link.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const pdfContent = `%PDF-1.4\n% Student Assignment Submission\nStudent: ${sub.studentName} (${sub.rollNumber})\nAssignment: ${parentAssignment?.title || 'Assignment'}\nSubmitted At: ${sub.submittedAt || new Date().toISOString()}\n`;
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Student Submissions</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Review and grade student submissions.
        </p>
      </div>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <input
          type="text"
          className="form-input"
          placeholder="Search by student, roll number, or assignment..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: '380px' }}
        />

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <select
            className="form-select"
            value={selectedAssignmentId}
            onChange={(e) => setSelectedAssignmentId(e.target.value)}
            style={{ minWidth: '180px' }}
          >
            <option value="all">All Assignments</option>
            {teacherAssignments.map(a => (
              <option key={a.id} value={a.id}>{a.title}</option>
            ))}
          </select>

          <select
            className="form-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ minWidth: '140px' }}
          >
            <option value="all">All Statuses</option>
            <option value="submitted">Pending</option>
            <option value="graded">Graded</option>
            <option value="late">Late</option>
          </select>
        </div>
      </div>
      <div className="custom-table-container">
        <table className="custom-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Assignment</th>
              <th>Submitted Date</th>
              <th>Status</th>
              <th>Marks</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredSubmissions.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No submissions found matching criteria.
                </td>
              </tr>
            ) : (
              filteredSubmissions.map(sub => {
                const parentAssignment = assignments.find(a => a.id === sub.assignmentId || a._id === sub.assignmentId);
                const maxMarks = parentAssignment?.maxMarks || 25;

                return (
                  <tr key={sub.id || sub._id}>
                    <td>
                      <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{sub.studentName}</p>
                    </td>

                    <td>
                      <p style={{ fontWeight: 600, color: 'var(--text-primary)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {parentAssignment?.title || 'Assignment Task'}
                      </p>
                    </td>

                    <td>
                      <span style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                        {formatDate(sub.submittedAt)}
                      </span>
                    </td>

                    <td>
                      {sub.isLate ? (
                        <Badge status="Late Submission" />
                      ) : (
                        <Badge status={sub.status} />
                      )}
                    </td>

                    <td>
                      {sub.status === 'graded' ? (
                        <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--primary)' }}>
                          {sub.marks > maxMarks ? Math.round((sub.marks / 100) * maxMarks) : sub.marks} / {maxMarks}
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.82rem', color: '#D97706', fontWeight: 600 }}>
                          Pending
                        </span>
                      )}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleDownload(sub)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.35rem 0.65rem' }}
                          title="Download Submitted PDF"
                        >
                          Download
                        </button>

                        <button
                          type="button"
                          className={`btn btn-sm ${sub.status === 'graded' ? 'btn-secondary' : 'btn-primary'}`}
                          onClick={() => handleOpenGrade(sub)}
                          style={{ padding: '0.35rem 0.75rem' }}
                        >
                          {sub.status === 'graded' ? 'Edit Grade' : 'Grade'}
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

      {activeSubmission && activeAssignment && (
        <GradeModal
          isOpen={!!activeSubmission}
          onClose={() => {
            setActiveSubmission(null);
            setActiveAssignment(null);
          }}
          submission={activeSubmission}
          assignment={activeAssignment}
        />
      )}
    </div>
  );
}
