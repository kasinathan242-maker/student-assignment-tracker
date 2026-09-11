export function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

export function formatDateTime(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

export function isPastDeadline(dueDateString) {
  if (!dueDateString) return false;
  return new Date(dueDateString).getTime() < Date.now();
}

export function getDeadlineInfo(dueDateString) {
  if (!dueDateString) return { text: 'No deadline', isUrgent: false, isOverdue: false, badgeVariant: 'gray' };

  const due = new Date(dueDateString).getTime();
  const now = Date.now();
  const diffMs = due - now;
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) {
    const overdueDays = Math.abs(Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    return {
      text: overdueDays === 0 ? 'Overdue today' : `Overdue by ${overdueDays} ${overdueDays === 1 ? 'day' : 'days'}`,
      isUrgent: true,
      isOverdue: true,
      badgeVariant: 'rose',
      daysLeft: -overdueDays
    };
  }

  if (diffHours <= 24) {
    return {
      text: 'Due today',
      isUrgent: true,
      isOverdue: false,
      badgeVariant: 'rose',
      daysLeft: 0
    };
  }

  if (diffHours <= 48) {
    return {
      text: 'Due tomorrow',
      isUrgent: true,
      isOverdue: false,
      badgeVariant: 'amber',
      daysLeft: 1
    };
  }

  if (diffDays <= 3) {
    return {
      text: `Due in ${diffDays} days`,
      isUrgent: true,
      isOverdue: false,
      badgeVariant: 'amber',
      daysLeft: diffDays
    };
  }

  return {
    text: `Due in ${diffDays} days`,
    isUrgent: false,
    isOverdue: false,
    badgeVariant: 'cyan',
    daysLeft: diffDays
  };
}

export function timeAgo(dateString) {
  if (!dateString) return '';
  const now = Date.now();
  const past = new Date(dateString).getTime();
  const diffSeconds = Math.floor((now - past) / 1000);

  if (diffSeconds < 60) return 'Just now';
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(dateString);
}
