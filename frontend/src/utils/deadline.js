export const deriveStatus = (deadline, submission) => {
  const now = new Date();
  const deadlineDate = new Date(deadline);

  if (!submission) {
    return now <= deadlineDate ? 'pending' : 'overdue';
  }

  if (submission.status === 'reviewed') {
    return 'reviewed';
  }

  if (submission.isLate) {
    return 'submitted_late';
  }

  return 'submitted';
};

export const formatRemainingTime = (deadline) => {
  const now = new Date();
  const target = new Date(deadline);
  const diffMs = target.getTime() - now.getTime();
  const isPast = diffMs < 0;
  const absDiffMs = Math.abs(diffMs);

  const totalHours = Math.floor(absDiffMs / (1000 * 60 * 60));
  const totalDays = Math.floor(absDiffMs / (1000 * 60 * 60 * 24));

  if (isPast) {
    if (totalDays >= 1) {
      return `Overdue by ${totalDays} ${totalDays === 1 ? 'day' : 'days'}`;
    }
    return totalHours <= 1 ? 'Overdue by 1 hour' : `Overdue by ${totalHours} hours`;
  }

  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const calendarDays = Math.round((targetMidnight - nowMidnight) / (1000 * 60 * 60 * 24));

  if (calendarDays === 0) {
    return 'Due today';
  }

  if (calendarDays === 1) {
    return 'Due tomorrow';
  }

  if (totalHours < 24) {
    return totalHours <= 1 ? '1 hour remaining' : `${totalHours} hours remaining`;
  }

  return `${totalDays} days remaining`;
};

export const formatDate = (dateString) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

export const toInputDateTime = (dateString) => {
  if (!dateString) return '';
  const d = new Date(dateString);
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};
