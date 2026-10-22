import React from 'react';
import { Link } from 'react-router-dom';

const EmptyState = ({
  title = 'No records found',
  description = 'There are no items to display at this time.',
  actionText,
  actionLink,
  onAction
}) => {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      {actionText && actionLink && (
        <Link to={actionLink} className="btn btn-primary empty-state-btn">
          {actionText}
        </Link>
      )}
      {actionText && onAction && !actionLink && (
        <button type="button" onClick={onAction} className="btn btn-primary empty-state-btn">
          {actionText}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
