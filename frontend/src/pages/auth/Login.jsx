import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function Login() {
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const queryParams = new URLSearchParams(location.search);
  const initialRole = queryParams.get('role') || 'student';

  const [selectedRole, setSelectedRole] = useState(initialRole);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const r = queryParams.get('role');
    if (r && ['student', 'teacher', 'admin'].includes(r)) {
      setSelectedRole(r);
    }
  }, [location.search]);

  const roleMeta = {
    student: {
      title: 'Student Login',
      badge: 'Student Portal',
      desc: 'Submit assignments, upload PDF coursework, and view allotted marks and feedback.'
    },
    teacher: {
      title: 'Faculty Teacher Login',
      badge: 'Faculty Portal',
      desc: 'Create assignments, evaluate student submissions, and grade coursework out of 25.'
    },
    admin: {
      title: 'HOD Admin Login',
      badge: 'HOD Master Portal',
      desc: 'Administrative access to view, create, edit, grade, and manage students, faculty, and coursework.'
    }
  };

  const currentMeta = roleMeta[selectedRole] || roleMeta.student;

  const handleRoleSelect = (r) => {
    setSelectedRole(r);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(email, password);
    setLoading(false);

    if (result.success) {
      const actualRole = result.user?.role || selectedRole;

      if (selectedRole !== actualRole) {
        logout();
        if (selectedRole === 'student') {
          setError(`This email is registered as a ${actualRole === 'teacher' ? 'Faculty Teacher' : 'HOD Admin'}. Please switch to the ${actualRole === 'teacher' ? 'Teacher' : 'HOD / Admin'} tab above to log in.`);
        } else if (selectedRole === 'teacher') {
          setError(`This email is registered as a ${actualRole === 'student' ? 'Student' : 'HOD Admin'}. Please switch to the ${actualRole === 'student' ? 'Student' : 'HOD / Admin'} tab above to log in.`);
        } else {
          setError(`This email is registered as a ${actualRole === 'student' ? 'Student' : 'Faculty Teacher'}. Please switch to your respective tab.`);
        }
        return;
      }

      if (actualRole === 'admin') {
        navigate('/admin/dashboard');
      } else if (actualRole === 'teacher') {
        navigate('/teacher/dashboard');
      } else {
        navigate('/student/dashboard');
      }
    } else {
      setError(result.message);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-container">
        
        <div className="auth-header">
          <h1 className="auth-title">
            Student Assignment Tracker
          </h1>
          <p className="auth-subtitle">
            Academic Assignment and Grading Management System
          </p>
        </div>
        <div className="auth-role-tabs">
          <button
            type="button"
            onClick={() => handleRoleSelect('student')}
            className={`auth-role-tab ${selectedRole === 'student' ? 'auth-role-tab-active' : ''}`}
          >
            Student
          </button>

          <button
            type="button"
            onClick={() => handleRoleSelect('teacher')}
            className={`auth-role-tab ${selectedRole === 'teacher' ? 'auth-role-tab-active' : ''}`}
          >
            Teacher
          </button>

          <button
            type="button"
            onClick={() => handleRoleSelect('admin')}
            className={`auth-role-tab ${selectedRole === 'admin' ? 'auth-role-tab-active' : ''}`}
          >
            HOD / Admin
          </button>
        </div>

        <div className="auth-card">
          <div className="auth-portal-info">
            <h2 className="auth-portal-title">
              {currentMeta.title}
            </h2>
            <span className="auth-portal-badge">
              {currentMeta.badge}
            </span>
          </div>

          <p className="auth-subtitle" style={{ marginBottom: '1.25rem' }}>
            {currentMeta.desc}
          </p>

          {error && (
            <div className="auth-error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                type="email"
                className="form-input"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg"
              style={{ width: '100%', marginTop: '0.5rem' }}
              disabled={loading}
            >
              {loading ? 'Signing in...' : `Sign In to ${currentMeta.badge}`}
            </button>
          </form>

          <div className="auth-footer">
            Need a new account?{' '}
            <Link to={`/register?role=${selectedRole}`} className="auth-footer-link">
              Create an Account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
