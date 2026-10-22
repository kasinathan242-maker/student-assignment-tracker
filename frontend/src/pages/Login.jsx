import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please provide both email and password.');
      return;
    }

    setSubmitting(true);
    try {
      const loggedUser = await login(email, password);
      if (loggedUser.role === 'teacher') {
        navigate('/teacher');
      } else {
        navigate('/student');
      }
    } catch (err) {
      const msg =
        err.response?.data?.message || 'Invalid email or password';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickLogin = (demoEmail, demoPass) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError('');
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h2 className="auth-title">Welcome Back</h2>
          <p className="auth-subtitle">
            Sign in to access your course assignments and dashboard.
          </p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="form-group">
            <label htmlFor="login-email" className="form-label">
              Academic Email
            </label>
            <input
              id="login-email"
              type="email"
              className="form-input"
              placeholder="e.g. kavya@northfield.test or teacher@demo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-password" className="form-label">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={submitting}
          >
            {submitting ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <div className="demo-fill-section">
          <span className="demo-fill-label">Quick Demo Fill:</span>
          <div className="demo-fill-buttons">
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => handleQuickLogin('teacher@demo.com', 'teacher123')}
            >
              Teacher
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => handleQuickLogin('student1@demo.com', 'student123')}
            >
              Student 1 (Alice)
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => handleQuickLogin('student2@demo.com', 'student123')}
            >
              Student 2 (Bob)
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => handleQuickLogin('student3@demo.com', 'student123')}
            >
              Student 3 (Charlie)
            </button>
          </div>
        </div>

        <div className="auth-footer">
          Don't have an account yet?{' '}
          <Link to="/register" className="auth-link">
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;
