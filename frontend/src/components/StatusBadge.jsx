import React from 'react';

const STATUS_CONFIG = {
  pending: {
    label: 'Pending',
    className: 'badge-pending'
  },
  overdue: {
    label: 'Overdue',
    className: 'badge-overdue'
  },
  submitted: {
    label: 'Submitted',
    className: 'badge-submitted'
  },
  submitted_late: {
    label: 'Late Submission',
    className: 'badge-late'
  },
  reviewed: {
    label: 'Reviewed',
    className: 'badge-reviewed'
  }
};

const StatusBadge = ({ status }) => {
  const config = STATUS_CONFIG[status] || {
    label: status ? status.replace(/_/g, ' ') : 'Unknown',
    className: 'badge-default'
  };

  return (
    <span className={`badge ${config.className}`}>
      <span className="badge-dot"></span>
      {config.label}
    </span>
  );
};

export default StatusBadge;
