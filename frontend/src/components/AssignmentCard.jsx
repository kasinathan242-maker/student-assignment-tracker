import React from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge';
import { formatDate } from '../utils/deadline';

const AssignmentCard = ({ assignment, userRole = 'student' }) => {
  const isPast = new Date(assignment.deadline) < new Date();

  return (
    <div className={`assignment-card ${isPast ? 'card-past' : ''}`}>
      <div className="assignment-card-header">
        <span className="subject-tag">{assignment.subject}</span>
        {userRole === 'student' && assignment.derivedStatus && (
          <StatusBadge status={assignment.derivedStatus} />
        )}
      </div>

      <h3 className="assignment-card-title">{assignment.title}</h3>
      <p className="assignment-card-desc">
        {assignment.description?.length > 130
          ? `${assignment.description.substring(0, 130)}...`
          : assignment.description}
      </p>

      <div className="assignment-card-meta">
        <div className="meta-item">
          <span className="meta-label">Deadline:</span>
          <span className="meta-value">{formatDate(assignment.deadline)}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Max Marks:</span>
          <span className="meta-value score-highlight">{assignment.maxMarks}</span>
        </div>
        {assignment.remainingTime && (
          <div className="meta-item">
            <span className="meta-label">Timing:</span>
            <span
              className={`timing-pill ${
                assignment.remainingTime.startsWith('Overdue')
                  ? 'timing-overdue'
                  : assignment.remainingTime.includes('Due today')
                  ? 'timing-urgent'
                  : 'timing-normal'
              }`}
            >
              {assignment.remainingTime}
            </span>
          </div>
        )}
      </div>

      <div className="assignment-card-footer">
        {userRole === 'student' ? (
          <Link
            to={`/student/assignments/${assignment._id}`}
            className="btn btn-outline btn-block"
          >
            {assignment.derivedStatus === 'pending' || assignment.derivedStatus === 'overdue'
              ? 'Submit Assignment'
              : 'View Details & Feedback'}
          </Link>
        ) : (
          <Link
            to={`/teacher/assignments/${assignment._id}/submissions`}
            className="btn btn-outline btn-block"
          >
            View Submissions ({assignment.submissionCount || 0})
          </Link>
        )}
      </div>
    </div>
  );
};

export default AssignmentCard;
