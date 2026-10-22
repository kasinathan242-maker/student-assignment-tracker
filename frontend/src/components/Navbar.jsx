import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navbar = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    setMobileMenuOpen(false);
    navigate('/login');
  };

  const closeMobile = () => setMobileMenuOpen(false);

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-brand" onClick={closeMobile}>
          <div className="brand-icon">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="brand-text">AssignmentTracker</span>
        </Link>

        {isAuthenticated && (
          <button
            className="navbar-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle Navigation Menu"
          >
            <span className={`hamburger-bar ${mobileMenuOpen ? 'open' : ''}`}></span>
          </button>
        )}

        <div className={`navbar-menu ${mobileMenuOpen ? 'active' : ''}`}>
          {isAuthenticated ? (
            <>
              <div className="nav-links">
                {user?.role === 'student' && (
                  <>
                    <NavLink
                      to="/student"
                      end
                      className={({ isActive }) =>
                        `nav-link ${isActive ? 'nav-link-active' : ''}`
                      }
                      onClick={closeMobile}
                    >
                      Dashboard
                    </NavLink>
                    <NavLink
                      to="/student/assignments"
                      className={({ isActive }) =>
                        `nav-link ${isActive ? 'nav-link-active' : ''}`
                      }
                      onClick={closeMobile}
                    >
                      Assignments
                    </NavLink>
                    <NavLink
                      to="/student/submissions"
                      className={({ isActive }) =>
                        `nav-link ${isActive ? 'nav-link-active' : ''}`
                      }
                      onClick={closeMobile}
                    >
                      My Submissions
                    </NavLink>
                  </>
                )}

                {user?.role === 'teacher' && (
                  <>
                    <NavLink
                      to="/teacher"
                      end
                      className={({ isActive }) =>
                        `nav-link ${isActive ? 'nav-link-active' : ''}`
                      }
                      onClick={closeMobile}
                    >
                      Dashboard
                    </NavLink>
                    <NavLink
                      to="/teacher/assignments"
                      end
                      className={({ isActive }) =>
                        `nav-link ${isActive ? 'nav-link-active' : ''}`
                      }
                      onClick={closeMobile}
                    >
                      Manage Assignments
                    </NavLink>
                    <Link
                      to="/teacher/assignments/new"
                      className="btn btn-primary btn-sm nav-create-btn"
                      onClick={closeMobile}
                    >
                      + Create Assignment
                    </Link>
                  </>
                )}
              </div>

              <div className="navbar-user-section">
                <div className="user-profile-badge">
                  <span className="user-name">{user?.name}</span>
                  <span className={`user-role-tag role-${user?.role}`}>
                    {user?.role === 'teacher' ? 'Instructor' : 'Student'}
                  </span>
                </div>
                <button
                  onClick={handleLogout}
                  className="btn btn-secondary btn-sm logout-btn"
                >
                  Sign Out
                </button>
              </div>
            </>
          ) : (
            <div className="nav-auth-actions">
              <NavLink
                to="/login"
                className={({ isActive }) =>
                  `nav-link ${isActive ? 'nav-link-active' : ''}`
                }
              >
                Sign In
              </NavLink>
              <Link to="/register" className="btn btn-primary btn-sm">
                Get Started
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
