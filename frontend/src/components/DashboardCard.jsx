import React from 'react';

const DashboardCard = ({
  title,
  value,
  description,
  variant = 'indigo',
  icon
}) => {
  return (
    <div className={`dashboard-card variant-${variant}`}>
      <div className="dashboard-card-top">
        <span className="dashboard-card-title">{title}</span>
        {icon && <div className="dashboard-card-icon">{icon}</div>}
      </div>
      <div className="dashboard-card-value">{value}</div>
      {description && (
        <div className="dashboard-card-description">{description}</div>
      )}
    </div>
  );
};

export default DashboardCard;
