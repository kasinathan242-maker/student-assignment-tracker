import React from 'react';

export default function Badge({ status, variant, label, className = '' }) {
  let styleClass = 'badge-gray';
  let text = label || status;

  const normalized = (status || '').toLowerCase();

  switch (normalized) {
    case 'graded':
      styleClass = 'badge-emerald';
      break;
    case 'submitted':
      styleClass = 'badge-cyan';
      break;
    case 'late':
    case 'late submission':
      styleClass = 'badge-rose';
      text = 'Late Submission';
      break;
    case 'pending':
      styleClass = 'badge-amber';
      break;
    case 'overdue':
      styleClass = 'badge-rose';
      break;
    case 'due soon':
      styleClass = 'badge-amber';
      break;
    case 'published':
    case 'active':
      styleClass = 'badge-indigo';
      break;
    case 'draft':
      styleClass = 'badge-gray';
      break;
    case 'closed':
      styleClass = 'badge-gray';
      break;
    case 'high':
    case 'urgent':
      styleClass = 'badge-rose';
      break;
    case 'medium':
      styleClass = 'badge-amber';
      break;
    case 'normal':
    case 'low':
      styleClass = 'badge-cyan';
      break;
    default:
      if (variant) {
        styleClass = `badge-${variant}`;
      }
      break;
  }

  return (
    <span className={`badge ${styleClass} ${className}`}>
      <span>{text}</span>
    </span>
  );
}

