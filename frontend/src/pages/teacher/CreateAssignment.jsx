import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext';
import { useAuth } from '../../context/AuthContext';

export default function CreateAssignment() {
  const { courses, classes, createAssignment } = useAppData();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const todayStr = new Date().toISOString().split('T')[0];
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split('T')[0];

  const [formData, setFormData] = useState({
    title: '',
    dueDate: nextWeekStr,
  });

  const [attachedFile, setAttachedFile] = useState(null);
  const [attachedFileData, setAttachedFileData] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setAttachedFile(file);
      const reader = new FileReader();
      reader.onload = () => {
        setAttachedFileData(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveFile = () => {
    setAttachedFile(null);
    setAttachedFileData(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.title.trim()) return;

    const defaultCourse = courses[0] || { id: 'c-1', name: 'Computer Science', code: 'CS-301' };
    const defaultClass = classes[0] || { id: 'cls-1', code: 'Batch A', name: 'Batch A' };

    const payload = {
      title: formData.title.trim(),
      description: formData.title.trim(),
      instructions: attachedFile 
        ? `Please refer to the attached document "${attachedFile.name}" for the complete assignment tasks and submission criteria.`
        : 'Please complete and submit your work before the deadline.',
      courseId: defaultCourse.id,
      courseName: defaultCourse.name,
      classId: defaultClass.id,
      className: defaultClass.code || defaultClass.name,
      subject: defaultCourse.code || 'General',
      startDate: todayStr,
      dueDate: formData.dueDate.includes('T') ? formData.dueDate : `${formData.dueDate}T23:59`,
      maxMarks: 25,
      priority: 'normal',
      teacherId: currentUser?.id || currentUser?._id,
      teacherName: currentUser?.name || 'Mohan Kasinathan',
      attachmentName: attachedFile ? attachedFile.name : null,
      attachmentUrl: attachedFileData || '#',
      status: 'published'
    };

    createAssignment(payload);
    setSuccess(true);

    setTimeout(() => {
      navigate('/teacher/assignments');
    }, 1000);
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button 
          className="btn btn-secondary btn-sm"
          onClick={() => navigate('/teacher/assignments')}
        >
          ← Back to Assignments
        </button>
      </div>

      <div className="glass-card" style={{ padding: '2rem' }}>
        <div style={{ marginBottom: '1.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Create New Assignment</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Enter the assignment title and due date to assign it to students.
          </p>
        </div>

        {success && (
          <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 'var(--radius-md)', padding: '1rem', color: '#10B981', display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: '0.95rem' }}>Assignment Published Successfully!</p>
              <p style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                Redirecting to assignments list...
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label" style={{ fontWeight: 600, marginBottom: '0.5rem', display: 'block' }}>
              Assignment Title *
            </label>
            <input
              type="text"
              name="title"
              className="form-input"
              required
              placeholder="e.g. Build a Student REST API"
              value={formData.title}
              onChange={handleChange}
              style={{ width: '100%' }}
            />
          </div>
          <div className="form-group" style={{ marginBottom: '1.75rem' }}>
            <label className="form-label" style={{ fontWeight: 600, marginBottom: '0.5rem', display: 'block' }}>
              Due Date *
            </label>
            <input
              type="date"
              name="dueDate"
              className="form-input"
              required
              value={formData.dueDate}
              onChange={handleChange}
              style={{ width: '100%' }}
            />
          </div>
          {attachedFile && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#F0FDF4',
              border: '1px solid #BBF7D0',
              padding: '0.65rem 1rem',
              borderRadius: 'var(--radius-md)',
              marginBottom: '1.25rem',
              fontSize: '0.875rem',
              color: '#166534'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700 }}>Assignment File:</span>
                <span style={{ fontWeight: 600, color: '#15803D' }}>{attachedFile.name}</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>({(attachedFile.size / 1024).toFixed(1)} KB)</span>
              </div>
              <button
                type="button"
                onClick={handleRemoveFile}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#DC2626',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '0.8rem'
                }}
              >
                Remove File
              </button>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem', flexWrap: 'wrap' }}>
            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf,.doc,.docx,.txt,.zip"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            <button
              type="button"
              className={`btn-upload ${attachedFile ? 'btn-upload-done' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              style={{ padding: '0.55rem 1.1rem', fontSize: '0.875rem' }}
              title="Upload question paper or assignment document"
            >
              {attachedFile ? 'Change Assignment File' : 'Upload Assignment File'}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/teacher/assignments')}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={success}
            >
              Publish Assignment
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
