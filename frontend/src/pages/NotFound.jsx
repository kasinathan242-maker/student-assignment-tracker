import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NotFound = () => {
  const { user, isAuthenticated } = useAuth();

  const destination = isAuthenticated
    ? user?.role === 'teacher'
      ? '/teacher'
      : '/student'
    : '/';

  return (
    <div className="not-found-page">
      <div className="not-found-card">
        <div className="not-found-code">404</div>
        <h1 className="not-found-title">Page Not Found</h1>
        <p className="not-found-desc">
          The requested URL does not exist or you do not have permission to view this resource.
        </p>
        <Link to={destination} className="btn btn-primary">
          Return to {isAuthenticated ? 'Dashboard' : 'Home'}
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
