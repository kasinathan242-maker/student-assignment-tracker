import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext';
import { useAuth } from '../../context/AuthContext';
import StatCard from '../../components/StatCard';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import { getDeadlineInfo, formatDate, formatDateTime } from '../../utils/dateUtils';

export default function StudentDashboard() {
  const { currentUser } = useAuth();
  const { assignments, submissions, submitAssignment } = useAppData();
  const navigate = useNavigate();

  const [uploadedFiles, setUploadedFiles] = useState({});
  const [selectedAssignment, setSelectedAssignment] = useState(null);

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
      studentId: currentUser?.id,
      studentName: currentUser?.name || 'Student',
      studentEmail: currentUser?.email || '',
      rollNumber: currentUser?.rollNumber || '',
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
  const studentAssignments = assignments.filter(
    a => !a.classId || a.classId === currentUser?.classId || a.className === currentUser?.className
  );
  const studentSubmissions = submissions.filter(s => s.studentId === currentUser?.id);

  const submittedAssignmentIds = studentSubmissions.map(s => s.assignmentId);
  const pendingAssignments = studentAssignments.filter(a => !submittedAssignmentIds.includes(a.id));
  const completedCount = studentSubmissions.length;

  const overdueAssignments = pendingAssignments.filter(a => new Date(a.dueDate).getTime() < Date.now());

  const gradedList = studentSubmissions.filter(s => s.status === 'graded' && typeof s.marks === 'number');
  const avgGrade = gradedList.length > 0 
    ? (gradedList.reduce((acc, curr) => acc + curr.marks, 0) / gradedList.length).toFixed(1)
    : '0';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>
            Student Workspace
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Welcome back, {currentUser?.name || 'Kasi'}!
          </p>
        </div>

        <button 
          className="btn btn-primary" 
          onClick={() => navigate('/student/assignments')}
        >
          View My Assignments
        </button>
      </div>

      <div className="stat-card-grid">
        <StatCard
          title="Total Assigned"
          value={studentAssignments.length}
          subtext="Course curriculum tasks"
        />
        <StatCard
          title="Pending Turn-In"
          value={pendingAssignments.length}
          subtext={`${overdueAssignments.length} past scheduled deadline`}
        />
        <StatCard
          title="Completed Work"
          value={completedCount}
          subtext={`${gradedList.length} assignments graded`}
        />
        <StatCard
          title="Grade Average"
          value={`${avgGrade}%`}
          subtext={gradedList.length > 0 ? "Academic Standing: Good" : "No grades yet"}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
        
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1.1rem' }}>Tasks Requiring Your Submission</h3>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/student/assignments')}>
              View All ({pendingAssignments.length})
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {pendingAssignments.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <p style={{ fontWeight: 600 }}>All caught up!</p>
                <p style={{ fontSize: '0.8rem' }}>No pending assignments at this moment.</p>
              </div>
            ) : (
              pendingAssignments.slice(0, 3).map(item => {
                const info = getDeadlineInfo(item.dueDate);
                const asgnId = item.id || item._id;
                const uploaded = uploadedFiles[asgnId];

                return (
                      <div
                        key={asgnId}
                        style={{
                          padding: '1rem',
                          background: '#F8FAFC',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-md)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '0.75rem'
                        }}
                      >
                        <div>
                          <h4 style={{ fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                            {item.title}
                          </h4>
                          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                            {item.courseName} • Max: {item.maxMarks}
                          </p>
                        </div>

                        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
                          <Badge status={info.text} variant={info.badgeVariant} />
                          <div className="action-btn-group" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setSelectedAssignment(item)}
                              title="View assignment details and instructions"
                            >
                              View Details
                            </button>

                            <input
                              type="file"
                              id={`stdash-pdf-${asgnId}`}
                              accept="application/pdf,.pdf"
                              style={{ display: 'none' }}
                              onChange={(e) => handleFileUpload(asgnId, e)}
                            />
                            <button
                              type="button"
                              className={`btn-upload ${uploaded ? 'btn-upload-done' : ''}`}
                              onClick={() => document.getElementById(`stdash-pdf-${asgnId}`).click()}
                              title={uploaded ? uploaded.fileName : 'Upload PDF'}
                            >
                              {uploaded 
                                ? (uploaded.fileName.length > 10 
                                    ? uploaded.fileName.slice(0, 8) + '...pdf' 
                                    : uploaded.fileName)
                                : 'Upload File'}
                            </button>

                            <button
                              type="button"
                              className={`btn-submit ${uploaded ? 'btn-submit-ready' : ''}`}
                              disabled={!uploaded}
                              onClick={() => handleSubmitWork(item)}
                              title={uploaded ? 'Click to submit' : 'Please upload a PDF first'}
                            >
                              Submit
                            </button>
                          </div>
                        </div>
                      </div>
                    );
              })
            )}
          </div>
        </div>

        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1.1rem' }}>Recent Faculty Feedback</h3>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/student/grades')}>
              View Report
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {gradedList.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <p>No graded submissions available yet.</p>
              </div>
            ) : (
              gradedList.map(sub => {
                const asgn = assignments.find(a => a.id === sub.assignmentId);
                return (
                  <div
                    key={sub.id}
                    style={{
                      padding: '1rem',
                      background: '#F8FAFC',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
                      <h4 style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                        {asgn?.title || 'Assignment'}
                      </h4>
                      <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--primary)' }}>
                        {sub.marks} / {asgn?.maxMarks || 25}
                      </span>
                    </div>

                    {sub.feedback && (
                      <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', background: 'rgba(37, 99, 235, 0.06)', borderLeft: '3px solid var(--primary)', padding: '0.5rem 0.75rem', borderRadius: '4px', margin: '0.5rem 0', fontStyle: 'italic' }}>
                        "{sub.feedback}"
                      </p>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                      <span>Graded by: {sub.gradedBy || 'Faculty'}</span>
                      <span>{formatDate(sub.gradedAt)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
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
