import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext';
import { useAuth } from '../../context/AuthContext';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import { formatDate, getDeadlineInfo } from '../../utils/dateUtils';

export default function StudentAssignments() {
  const { assignments, submissions, submitAssignment } = useAppData();
  const { currentUser } = useAuth();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedAssignment, setSelectedAssignment] = useState(null);

  const studentAssignments = assignments;

  const mySubmissions = submissions.filter(s => s.studentId === currentUser?.id || s.studentId === currentUser?._id);

  const getStudentAssignmentStatus = (assignment) => {
    const asgnId = assignment.id || assignment._id;
    const sub = mySubmissions.find(s => s.assignmentId === asgnId);
    if (sub) {
      if (sub.status === 'graded') return { label: 'Graded', variant: 'emerald', marks: sub.marks, isSubmitted: true, submission: sub };
      if (sub.isLate) return { label: 'Late Submission', variant: 'rose', isSubmitted: true, submission: sub };
      return { label: 'Submitted', variant: 'cyan', isSubmitted: true, submission: sub };
    }

    const deadline = getDeadlineInfo(assignment.dueDate);
    if (deadline.isOverdue) return { label: 'Overdue', variant: 'rose', isSubmitted: false };
    if (deadline.isUrgent) return { label: deadline.text, variant: deadline.badgeVariant, isSubmitted: false };
    return { label: 'Pending', variant: 'amber', isSubmitted: false };
  };

  const [uploadedFiles, setUploadedFiles] = useState({});

  const handleFileUpload = (asgnId, e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('Only PDF files are allowed! Please select a .pdf file.');
      e.target.value = '';
      return;
    }

    setUploadedFiles(prev => ({
      ...prev,
      [asgnId]: {
        file,
        fileName: file.name,
        fileSize: (file.size / (1024 * 1024)).toFixed(2) + ' MB'
      }
    }));
  };

  const handleSubmitWork = (asgn) => {
    const asgnId = asgn.id || asgn._id;
    const fileData = uploadedFiles[asgnId];
    if (!fileData) {
      alert('Please upload a PDF file first!');
      return;
    }

    submitAssignment({
      assignmentId: asgnId,
      studentId: currentUser?.id || currentUser?._id || 'user-1',
      studentName: currentUser?.name || 'Student',
      studentEmail: currentUser?.email || '',
      rollNumber: currentUser?.rollNumber || 'CS2026-042',
      fileName: fileData.fileName,
      fileSize: fileData.fileSize,
      comment: 'Assignment submitted with PDF.'
    });
    alert('Submitted');
    setUploadedFiles(prev => {
      const copy = { ...prev };
      delete copy[asgnId];
      return copy;
    });
  };

  const filtered = studentAssignments.filter(asgn => {
    const statusInfo = getStudentAssignmentStatus(asgn);
    const matchesSearch = 
      asgn.title.toLowerCase().includes(search.toLowerCase()) ||
      (asgn.courseName && asgn.courseName.toLowerCase().includes(search.toLowerCase())) ||
      (asgn.subject && asgn.subject.toLowerCase().includes(search.toLowerCase()));

    if (!matchesSearch) return false;

    if (filter === 'pending') return !statusInfo.isSubmitted;
    if (filter === 'submitted') return statusInfo.isSubmitted;
    if (filter === 'graded') return statusInfo.label === 'Graded';
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>My Assignments</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            View your curriculum assignments, upload your coursework PDF, and submit your work.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <input
          type="text"
          className="form-input"
          placeholder="Search by assignment title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: '350px' }}
        />

        <select
          className="form-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: '180px' }}
        >
          <option value="all">All Assignments</option>
          <option value="pending">Pending</option>
          <option value="submitted">Submitted</option>
          <option value="graded">Graded</option>
        </select>
      </div>

      <div className="custom-table-container">
        <table className="custom-table">
          <thead>
            <tr>
              <th>Assignment Title</th>
              <th>Due Date</th>
              <th>Status</th>
              <th>Marks</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No assignments found.
                </td>
              </tr>
            ) : (
              filtered.map(asgn => {
                const statusInfo = getStudentAssignmentStatus(asgn);
                const deadline = getDeadlineInfo(asgn.dueDate);

                const asgnId = asgn.id || asgn._id;
                const uploaded = uploadedFiles[asgnId];

                return (
                  <tr key={asgnId}>
                    <td>
                      <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                        {asgn.title}
                      </p>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Faculty: {asgn.teacherName}
                      </span>
                    </td>

                    <td>
                      <p style={{ fontSize: '0.85rem' }}>{formatDate(asgn.dueDate)}</p>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: deadline.isOverdue ? '#DC2626' : deadline.isUrgent ? '#D97706' : 'var(--text-muted)' }}>
                        {deadline.text}
                      </span>
                    </td>

                    <td>
                      <Badge status={statusInfo.label} variant={statusInfo.variant} />
                    </td>

                    <td>
                      {statusInfo.label === 'Graded' ? (
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--primary)' }}>
                          {statusInfo.marks > (asgn.maxMarks || 25) ? Math.round((statusInfo.marks / 100) * (asgn.maxMarks || 25)) : statusInfo.marks} / {asgn.maxMarks || 25}
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          {asgn.maxMarks || 25}
                        </span>
                      )}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelectedAssignment(asgn)}
                          title="View assignment instructions and details"
                        >
                          View Details
                        </button>

                        {statusInfo.isSubmitted ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ color: '#10B981', fontWeight: 700, fontSize: '0.85rem' }}>
                              Submitted
                            </span>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                const blob = new Blob(['Sample PDF Assignment Content'], { type: 'application/pdf' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = statusInfo.submission?.fileName || `${asgn.title || 'assignment'}.pdf`;
                                a.click();
                                URL.revokeObjectURL(url);
                              }}
                              title="Download submitted coursework"
                            >
                              Download
                            </button>
                          </div>
                        ) : (
                          <div className="action-btn-group">
                            <input
                              type="file"
                              id={`pdf-file-${asgnId}`}
                              accept="application/pdf,.pdf"
                              style={{ display: 'none' }}
                              onChange={(e) => handleFileUpload(asgnId, e)}
                            />

                            <button
                              type="button"
                              className={`btn-upload ${uploaded ? 'btn-upload-done' : ''}`}
                              onClick={() => document.getElementById(`pdf-file-${asgnId}`).click()}
                              title={uploaded ? uploaded.fileName : 'Upload PDF file'}
                            >
                              {uploaded 
                                ? (uploaded.fileName.length > 12 
                                    ? uploaded.fileName.slice(0, 9) + '...pdf' 
                                    : uploaded.fileName)
                                : 'Upload File'}
                            </button>

                            <button
                              type="button"
                              className={`btn-submit ${uploaded ? 'btn-submit-ready' : ''}`}
                              disabled={!uploaded}
                              onClick={() => handleSubmitWork(asgn)}
                              title={uploaded ? 'Click to submit' : 'Please upload a PDF file first to submit'}
                            >
                              Submit
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Modal
        isOpen={!!selectedAssignment}
        onClose={() => setSelectedAssignment(null)}
        title={selectedAssignment?.title || 'Assignment Details'}
        subtitle={`${selectedAssignment?.courseName || 'Computer Science'} • Max Marks: ${selectedAssignment?.maxMarks || 25}`}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Faculty Instructor
            </span>
            <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
              {selectedAssignment?.teacherName || 'Faculty Professor'}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Submission Deadline
              </span>
              <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#DC2626', marginTop: '0.2rem' }}>
                {selectedAssignment ? formatDate(selectedAssignment.dueDate) : ''}
              </p>
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Maximum Score
              </span>
              <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--primary)', marginTop: '0.2rem' }}>
                {selectedAssignment?.maxMarks || 25} Marks
              </p>
            </div>
          </div>

          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Instructions & Description
            </span>
            <div style={{
              background: '#F8FAFC',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '1rem',
              marginTop: '0.35rem',
              fontSize: '0.9rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.6
            }}>
              {selectedAssignment?.instructions || selectedAssignment?.description || 'Please complete your coursework and submit the finished PDF document before the deadline.'}
            </div>
          </div>

          {selectedAssignment?.attachmentName && (
            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Teacher Attached Document
              </span>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#F0FDF4',
                border: '1px solid #BBF7D0',
                borderRadius: '8px',
                padding: '0.75rem 1rem',
                marginTop: '0.35rem',
                flexWrap: 'wrap',
                gap: '0.75rem'
              }}>
                <div>
                  <p style={{ fontSize: '0.9rem', fontWeight: 700, color: '#166534' }}>
                    {selectedAssignment.attachmentName}
                  </p>
                  <span style={{ fontSize: '0.75rem', color: '#15803D' }}>
                    Uploaded by Faculty Instructor
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const downloadUrl = selectedAssignment.attachmentUrl && selectedAssignment.attachmentUrl !== '#'
                      ? selectedAssignment.attachmentUrl
                      : URL.createObjectURL(new Blob([`Assignment: ${selectedAssignment.title}\nFaculty: ${selectedAssignment.teacherName}\n\nTask instructions:\n${selectedAssignment.instructions || selectedAssignment.description}`], { type: 'text/plain' }));
                    const a = document.createElement('a');
                    a.href = downloadUrl;
                    a.download = selectedAssignment.attachmentName;
                    a.click();
                  }}
                  title="Download attached assignment document"
                >
                  Download File
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSelectedAssignment(null)}
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
