import React from 'react';
import { Routes, Route } from 'react-router-dom';

import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';

import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import NotFound from './pages/NotFound';

import StudentDashboard from './pages/student/StudentDashboard';
import Assignments from './pages/student/Assignments';
import AssignmentDetails from './pages/student/AssignmentDetails';
import MySubmissions from './pages/student/MySubmissions';

import TeacherDashboard from './pages/teacher/TeacherDashboard';
import CreateAssignment from './pages/teacher/CreateAssignment';
import EditAssignment from './pages/teacher/EditAssignment';
import ManageAssignments from './pages/teacher/ManageAssignments';
import Submissions from './pages/teacher/Submissions';

function App() {
  return (
    <div className="app-container">
      <Navbar />
      <main className="main-content">
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Student Routes */}
          <Route
            path="/student"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/assignments"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <Assignments />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/assignments/:id"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <AssignmentDetails />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/submissions"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <MySubmissions />
              </ProtectedRoute>
            }
          />

          {/* Teacher Routes */}
          <Route
            path="/teacher"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <TeacherDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/assignments"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <ManageAssignments />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/assignments/new"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <CreateAssignment />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/assignments/:id/edit"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <EditAssignment />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/assignments/:id/submissions"
            element={
              <ProtectedRoute allowedRoles={['teacher']}>
                <Submissions />
              </ProtectedRoute>
            }
          />

          {/* Fallback 404 Catch-All */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
