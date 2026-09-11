import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppDataProvider } from './context/AppDataContext';
import MainLayout from './layouts/MainLayout';

import Login from './pages/auth/Login';
import Register from './pages/auth/Register';

import StudentDashboard from './pages/student/StudentDashboard';
import StudentAssignments from './pages/student/StudentAssignments';
import StudentGrades from './pages/student/StudentGrades';

import TeacherDashboard from './pages/teacher/TeacherDashboard';
import TeacherAssignments from './pages/teacher/TeacherAssignments';
import CreateAssignment from './pages/teacher/CreateAssignment';
import TeacherSubmissions from './pages/teacher/TeacherSubmissions';
import TeacherStudents from './pages/teacher/TeacherStudents';

import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUsers from './pages/admin/AdminUsers';

function RoleBasedRedirect() {
  const { isAuthenticated, currentUser, role } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const userRole = currentUser?.role || role || 'student';
  if (userRole === 'admin') return <Navigate to="/admin/dashboard" replace />;
  if (userRole === 'teacher') return <Navigate to="/teacher/dashboard" replace />;
  return <Navigate to="/student/dashboard" replace />;
}

function ProtectedRoute({ allowedRoles, children }) {
  const { isAuthenticated, currentUser, role } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const userRole = currentUser?.role || role || 'student';
  if (allowedRoles && !allowedRoles.includes(userRole)) {
    if (userRole === 'admin') return <Navigate to="/admin/dashboard" replace />;
    if (userRole === 'teacher') return <Navigate to="/teacher/dashboard" replace />;
    return <Navigate to="/student/dashboard" replace />;
  }

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <AppDataProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            <Route element={<MainLayout />}>
              <Route path="/" element={<RoleBasedRedirect />} />
              <Route path="/dashboard" element={<RoleBasedRedirect />} />
              <Route path="/student" element={<Navigate to="/student/dashboard" replace />} />
              <Route
                path="/student/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['student', 'admin']}>
                    <StudentDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/student/assignments"
                element={
                  <ProtectedRoute allowedRoles={['student', 'admin']}>
                    <StudentAssignments />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/student/grades"
                element={
                  <ProtectedRoute allowedRoles={['student', 'admin']}>
                    <StudentGrades />
                  </ProtectedRoute>
                }
              />

              <Route path="/teacher" element={<Navigate to="/teacher/dashboard" replace />} />
              <Route
                path="/teacher/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['teacher', 'admin']}>
                    <TeacherDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/teacher/assignments"
                element={
                  <ProtectedRoute allowedRoles={['teacher', 'admin']}>
                    <TeacherAssignments />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/teacher/assignments/create"
                element={
                  <ProtectedRoute allowedRoles={['teacher', 'admin']}>
                    <CreateAssignment />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/teacher/submissions"
                element={
                  <ProtectedRoute allowedRoles={['teacher', 'admin']}>
                    <TeacherSubmissions />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/teacher/students"
                element={
                  <ProtectedRoute allowedRoles={['teacher', 'admin']}>
                    <TeacherStudents />
                  </ProtectedRoute>
                }
              />

              <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
              <Route
                path="/admin/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <AdminUsers />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/assignments"
                element={
                  <ProtectedRoute allowedRoles={['student', 'admin']}>
                    <StudentAssignments />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/assignments/create"
                element={
                  <ProtectedRoute allowedRoles={['teacher', 'admin']}>
                    <CreateAssignment />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/submissions"
                element={
                  <ProtectedRoute allowedRoles={['teacher', 'admin']}>
                    <TeacherSubmissions />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/students"
                element={
                  <ProtectedRoute allowedRoles={['teacher', 'admin']}>
                    <TeacherStudents />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/grades"
                element={
                  <ProtectedRoute allowedRoles={['student', 'admin']}>
                    <StudentGrades />
                  </ProtectedRoute>
                }
              />
            </Route>

            <Route path="*" element={<RoleBasedRedirect />} />
          </Routes>
        </BrowserRouter>
      </AppDataProvider>
    </AuthProvider>
  );
}
