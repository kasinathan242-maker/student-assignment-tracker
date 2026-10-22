import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Loader from './Loader';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, token, loading } = useAuth();

  if (loading) {
    return <Loader fullScreen message="Verifying session..." />;
  }

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    const targetDashboard = user.role === 'teacher' ? '/teacher' : '/student';
    return <Navigate to={targetDashboard} replace />;
  }

  return children;
};

export default ProtectedRoute;
