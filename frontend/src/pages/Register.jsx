import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Register = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('student');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    // Client-side validation
    const errors = {};
    if (!name || name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters';
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Please provide a valid email address';
    }
    if (!password || password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }
    if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }
    if (role === 'teacher' && !inviteCode.trim()) {
      errors.inviteCode = 'Teacher invite code is required to register as instructor';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const newUser = await register({
        name: name.trim(),
        email: email.trim(),
        password,
        confirmPassword,
        role,
        ...(role === 'teacher' && { inviteCode: inviteCode.trim() })
      });

      if (newUser.role === 'teacher') {
        navigate('/teacher');
      } else {
        navigate('/student');
      }
    } catch (err) {
      if (err.response?.data?.errors) {
        const backendErrors = {};
        err.response.data.errors.forEach((e) => {
          backendErrors[e.field] = e.msg;
        });
        setFieldErrors(backendErrors);
        setError('Please correct the highlighted fields.');
      } else {
        setError(
          err.response?.data?.message || 'Registration failed. Please try again.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h2 className="auth-title">Create Account</h2>
          <p className="auth-subtitle">
            Join Student Assignment Tracker as a Student or Course Instructor.
          </p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="form-group">
            <label htmlFor="reg-name" className="form-label">
              Full Name
            </label>
            <input
              id="reg-name"
              type="text"
              className={`form-input ${fieldErrors.name ? 'input-error' : ''}`}
              placeholder="e.g. John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            {fieldErrors.name && (
              <span className="field-error-text">{fieldErrors.name}</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="reg-email" className="form-label">
              Email Address
            </label>
            <input
              id="reg-email"
              type="email"
              className={`form-input ${fieldErrors.email ? 'input-error' : ''}`}
              placeholder="e.g. student@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {fieldErrors.email && (
              <span className="field-error-text">{fieldErrors.email}</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="reg-role" className="form-label">
              Select Your Role
            </label>
            <select
              id="reg-role"
              className="form-input form-select"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="student">Student (Track & Submit Coursework)</option>
              <option value="teacher">Teacher / Instructor (Create & Grade)</option>
            </select>
          </div>

          {role === 'teacher' && (
            <div className="form-group teacher-code-reveal">
              <label htmlFor="reg-invite" className="form-label">
                Teacher Invite Code <span className="required-star">*</span>
              </label>
              <input
                id="reg-invite"
                type="text"
                className={`form-input ${fieldErrors.inviteCode ? 'input-error' : ''}`}
                placeholder="Enter instructor authorization code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
              />
              <span className="form-hint">
                Local demo invite code is <code>TEACHER2026</code>.
              </span>
              {fieldErrors.inviteCode && (
                <span className="field-error-text">{fieldErrors.inviteCode}</span>
              )}
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="reg-password" className="form-label">
                Password
              </label>
              <input
                id="reg-password"
                type="password"
                className={`form-input ${fieldErrors.password ? 'input-error' : ''}`}
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {fieldErrors.password && (
                <span className="field-error-text">{fieldErrors.password}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="reg-confirm" className="form-label">
                Confirm Password
              </label>
              <input
                id="reg-confirm"
                type="password"
                className={`form-input ${fieldErrors.confirmPassword ? 'input-error' : ''}`}
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
              {fieldErrors.confirmPassword && (
                <span className="field-error-text">{fieldErrors.confirmPassword}</span>
              )}
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={submitting}
          >
            {submitting ? 'Creating Account...' : 'Register Account'}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account?{' '}
          <Link to="/login" className="auth-link">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
