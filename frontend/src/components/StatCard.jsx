import React from 'react';

export default function StatCard({ 
  title, 
  value, 
  subtext, 
  trend,
  onClick 
}) {
  return (
    <div 
      className={`stat-card ${onClick ? 'glass-card-interactive' : ''}`}
      onClick={onClick}
    >
      <div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
          {title}
        </p>
        <h3 style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
          {value}
        </h3>
        {subtext && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            {subtext}
          </p>
        )}
        {trend && (
          <span style={{ fontSize: '0.75rem', color: trend.isPositive ? '#1D4ED8' : '#DC2626', fontWeight: 600 }}>
            {trend.text}
          </span>
        )}
      </div>
    </div>
  );
}
