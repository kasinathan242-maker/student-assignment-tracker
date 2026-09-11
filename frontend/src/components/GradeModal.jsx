import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';

export default function GradeModal({ isOpen, onClose, submission, assignment }) {
  const { gradeSubmission } = useAppData();
  const { currentUser } = useAuth();

  const [marks, setMarks] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (submission) {
      setMarks(submission.marks !== null && submission.marks !== undefined ? submission.marks : '');
      setFeedback(submission.feedback || '');
      setError('');
      setIsSaved(false);
    }
  }, [submission]);

  if (!submission || !assignment) return null;

  const maxMarks = assignment.maxMarks || 25;

  const handleSave = (e) => {
    e.preventDefault();
    const numericMarks = Number(marks);

    if (isNaN(numericMarks) || marks === '') {
      setError('Please enter valid marks.');
      return;
    }

    if (numericMarks < 0 || numericMarks > maxMarks) {
      setError(`Marks must be between 0 and ${maxMarks}.`);
      return;
    }

    gradeSubmission(submission.id, {
      marks: numericMarks,
      feedback: feedback.trim(),
      teacherName: currentUser?.name || 'Mohan Kasinathan'
    });

    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 800);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Grade Submission"
      subtitle={`${submission.studentName} (${submission.rollNumber}) — ${assignment.title}`}
      maxWidth="480px"
    >
      <form onSubmit={handleSave}>
        <div className="form-group" style={{ marginBottom: '1.25rem' }}>
          <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Marks *</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Out of {maxMarks}</span>
          </label>
          <input
            type="number"
            min="0"
            max={maxMarks}
            className="form-input"
            placeholder={`0 - ${maxMarks}`}
            value={marks}
            onChange={(e) => setMarks(e.target.value)}
            required
            autoFocus
          />
          {error && <span style={{ color: '#DC2626', fontSize: '0.8rem', marginTop: '0.25rem', display: 'block' }}>{error}</span>}
        </div>

        <div className="form-group" style={{ marginBottom: '1.5rem' }}>
          <label className="form-label">Feedback (Optional)</label>
          <textarea
            className="form-textarea"
            rows="3"
            placeholder="Add comments or feedback for the student..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button 
            type="submit" 
            className="btn btn-primary"
            disabled={isSaved}
          >
            {isSaved ? 'Saved!' : 'Save Grade'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
