import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Sidebar({ isOpen }) {
  const { currentUser, role, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userRole = currentUser?.role || role || 'student';

  let navLinks = [];
  if (userRole === 'admin') {
    navLinks = [
      { to: '/admin/dashboard', label: 'HOD Master Overview' },
      { to: '/teacher/assignments', label: 'All Coursework' },
      { to: '/assignments/create', label: '+ Create Assignment' },
      { to: '/submissions', label: 'All Submissions' },
      { to: '/student/assignments', label: 'Student Portal View' },
      { to: '/admin/users', label: 'Department Users' }
    ];
  } else if (userRole === 'teacher') {
    navLinks = [
      { to: '/teacher/dashboard', label: 'Faculty Dashboard' },
      { to: '/teacher/assignments', label: 'My Coursework' },
      { to: '/assignments/create', label: '+ Create Assignment' },
      { to: '/submissions', label: 'Student Submissions' },
      { to: '/students', label: 'Class Students' }
    ];
  } else {
    navLinks = [
      { to: '/student/dashboard', label: 'Student Workspace' },
      { to: '/student/assignments', label: 'My Assignments' },
      { to: '/student/grades', label: 'My Grades and Scores' }
    ];
  }

  const roleLabel = userRole === 'admin' 
    ? 'HOD Admin Portal' 
    : (userRole === 'teacher' ? 'Faculty Portal' : 'Student Portal');

  return (
    <aside
      style={{
        width: isOpen ? '250px' : '0px',
        minWidth: isOpen ? '250px' : '0px',
        background: '#FFFFFF',
        borderRight: '1px solid var(--border-color, #E2E8F0)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 30
      }}
    >
      <div className="sidebar-header-box">
        <p className="sidebar-portal-title">
          {roleLabel}
        </p>
        <span className="sidebar-portal-dept">
          {currentUser?.department || 'Computer Science'}
        </span>
      </div>

      <nav style={{ flex: 1, padding: '1rem 0.65rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', overflowY: 'auto' }}>
        {navLinks.map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            <span>{link.label}</span>
          </NavLink>
        ))}
      </nav>
      <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--border-color, #E2E8F0)', background: '#F8FAFC' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            User: <b>{currentUser?.name?.split(' ')[0] || 'User'}</b>
          </span>
          <span style={{
            fontSize: '0.65rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            padding: '0.15rem 0.45rem',
            borderRadius: '4px',
            background: '#F1F5F9',
            color: 'var(--text-secondary)'
          }}>
            {userRole}
          </span>
        </div>

        <button
          onClick={handleLogout}
          className="btn btn-secondary btn-sm"
          style={{ width: '100%', color: '#DC2626', borderColor: '#FECACA' }}
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
