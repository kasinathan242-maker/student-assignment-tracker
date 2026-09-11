import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar({ onToggleSidebar }) {
  const { currentUser, role, logout } = useAuth();
  const navigate = useNavigate();

  const [showUserMenu, setShowUserMenu] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userRole = currentUser?.role || role || 'student';

  const roleMeta = {
    admin: { label: 'HOD Admin', badgeClass: 'nav-role-badge nav-role-badge-admin' },
    teacher: { label: 'Faculty Teacher', badgeClass: 'nav-role-badge nav-role-badge-teacher' },
    student: { label: 'Student', badgeClass: 'nav-role-badge nav-role-badge-student' }
  };

  const currentBadge = roleMeta[userRole] || roleMeta.student;

  return (
    <header
      style={{
        height: '64px',
        background: '#FFFFFF',
        borderBottom: '1px solid var(--border-color, #E2E8F0)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 2rem',
        position: 'sticky',
        top: 0,
        zIndex: 40,
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button
          onClick={onToggleSidebar}
          className="btn btn-secondary btn-sm"
          style={{ padding: '0.45rem 0.65rem' }}
          title="Toggle Navigation Menu"
        >
          <div className="nav-menu-icon">
            <span />
            <span />
            <span />
          </div>
        </button>

        <div>
          <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Student Assignment Tracker
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {/* Role Pill Badge (No Emojis) */}
        <span className={currentBadge.badgeClass}>
          {currentBadge.label}
        </span>

        {/* User Profile Pill */}
        <div style={{ position: 'relative' }}>
          <div
            onClick={() => setShowUserMenu(!showUserMenu)}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0.4rem 1.1rem',
              background: '#F8FAFC',
              border: '1px solid var(--border-color, #E2E8F0)',
              borderRadius: '9999px',
              cursor: 'pointer'
            }}
          >
            <div style={{ textAlign: 'left', lineHeight: 1.25 }}>
              <p style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {currentUser?.name || 'User'}
              </p>
              <span style={{ fontSize: '0.68rem', color: 'var(--primary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {currentUser?.department || 'Account'}
              </span>
            </div>
          </div>

          {showUserMenu && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '0.4rem',
                background: '#FFFFFF',
                border: '1px solid var(--border-color, #E2E8F0)',
                borderRadius: '8px',
                width: '220px',
                boxShadow: 'var(--shadow-lg)',
                zIndex: 100,
                overflow: 'hidden'
              }}
            >
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>Signed in as</p>
                <p style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', margin: '0.2rem 0 0 0' }}>
                  {currentUser?.email}
                </p>
                <span style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 700 }}>
                  Role: {userRole.toUpperCase()}
                </span>
              </div>

              {userRole === 'admin' && (
                <div style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)', padding: '0.35rem 0' }}>
                  <button
                    onClick={() => { setShowUserMenu(false); navigate('/student/assignments'); }}
                    style={{
                      width: '100%',
                      padding: '0.45rem 1rem',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-primary)',
                      fontSize: '0.8rem',
                      textAlign: 'left',
                      cursor: 'pointer'
                    }}
                  >
                    View as Student
                  </button>
                  <button
                    onClick={() => { setShowUserMenu(false); navigate('/teacher/dashboard'); }}
                    style={{
                      width: '100%',
                      padding: '0.45rem 1rem',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-primary)',
                      fontSize: '0.8rem',
                      textAlign: 'left',
                      cursor: 'pointer'
                    }}
                  >
                    View as Teacher
                  </button>
                  <button
                    onClick={() => { setShowUserMenu(false); navigate('/admin/dashboard'); }}
                    style={{
                      width: '100%',
                      padding: '0.45rem 1rem',
                      background: 'transparent',
                      border: 'none',
                      color: '#6D28D9',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      textAlign: 'left',
                      cursor: 'pointer'
                    }}
                  >
                    HOD Master Overview
                  </button>
                </div>
              )}

              <button
                onClick={handleLogout}
                style={{
                  width: '100%',
                  padding: '0.7rem 1rem',
                  background: 'transparent',
                  border: 'none',
                  color: '#DC2626',
                  fontSize: '0.825rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
