import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  INITIAL_COURSES,
  INITIAL_CLASSES,
  INITIAL_ASSIGNMENTS,
  INITIAL_SUBMISSIONS
} from '../data/seedData';
import { useAuth } from './AuthContext';
import { isPastDeadline } from '../utils/dateUtils';

const AppDataContext = createContext(null);

export function AppDataProvider({ children }) {
  const { currentUser, users, setUsers } = useAuth();

  const [courses, setCourses] = useState(() => {
    try {
      const saved = localStorage.getItem('edutrack_courses');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  const [classes, setClasses] = useState(() => {
    try {
      const saved = localStorage.getItem('edutrack_classes');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  const [assignments, setAssignments] = useState(() => {
    try {
      const saved = localStorage.getItem('edutrack_assignments');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  const [submissions, setSubmissions] = useState(() => {
    try {
      const saved = localStorage.getItem('edutrack_submissions');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('edutrack_courses', JSON.stringify(courses));
  }, [courses]);

  useEffect(() => {
    localStorage.setItem('edutrack_classes', JSON.stringify(classes));
  }, [classes]);

  useEffect(() => {
    localStorage.setItem('edutrack_assignments', JSON.stringify(assignments));
  }, [assignments]);

  useEffect(() => {
    localStorage.setItem('edutrack_submissions', JSON.stringify(submissions));
  }, [submissions]);

  useEffect(() => {
    const fetchBackendData = async () => {
      try {
        const [asgnRes, subRes] = await Promise.all([
          fetch('http://localhost:5000/api/assignments'),
          fetch('http://localhost:5000/api/submissions')
        ]);
        if (asgnRes.ok) {
          const backendAssignments = await asgnRes.json();
          if (Array.isArray(backendAssignments)) {
            setAssignments(backendAssignments);
          }
        }
        if (subRes.ok) {
          const backendSubmissions = await subRes.json();
          if (Array.isArray(backendSubmissions)) {
            setSubmissions(backendSubmissions);
          }
        }
      } catch (err) {
      }
    };
    fetchBackendData();
  }, []);

  const createAssignment = async (assignmentData) => {
    let newAssignment = {
      id: `assign-${Date.now()}`,
      ...assignmentData,
      status: assignmentData.status || 'published',
      createdAt: new Date().toISOString()
    };

    try {
      const res = await fetch('http://localhost:5000/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assignmentData)
      });
      if (res.ok) {
        const saved = await res.json();
        newAssignment = { ...newAssignment, ...saved, id: saved.id || saved._id || newAssignment.id };
      }
    } catch (e) {
      console.warn('Backend offline, saving assignment locally', e);
    }

    setAssignments(prev => [newAssignment, ...prev]);
    return newAssignment;
  };

  const updateAssignment = async (id, updatedFields) => {
    setAssignments(prev => prev.map(a => (a.id === id || a._id === id ? { ...a, ...updatedFields } : a)));
    try {
      await fetch(`http://localhost:5000/api/assignments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFields)
      });
    } catch (e) {
      console.warn('Backend offline, updated assignment locally', e);
    }
  };

  const deleteAssignment = async (id) => {
    try {
      await fetch(`http://localhost:5000/api/assignments/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.warn('Backend offline, deleting locally', e);
    }
    setAssignments(prev => prev.filter(a => a.id !== id && a._id !== id));
    setSubmissions(prev => prev.filter(s => s.assignmentId !== id));
  };

  const submitAssignment = async ({ assignmentId, studentId, studentName, studentEmail, rollNumber, fileName, fileSize, comment }) => {
    const targetAssignment = assignments.find(a => a.id === assignmentId || a._id === assignmentId);
    const isLate = targetAssignment ? isPastDeadline(targetAssignment.dueDate) : false;
    const nowIso = new Date().toISOString();

    let newSubmission = {
      id: `sub-${Date.now()}`,
      assignmentId,
      studentId: studentId || '',
      studentName: studentName || 'Student',
      studentEmail: studentEmail || '',
      rollNumber: rollNumber || 'CS2026-N/A',
      fileName: fileName || 'solution.zip',
      fileSize: fileSize || '1.2 MB',
      fileUrl: '#',
      comment: comment || '',
      submittedAt: nowIso,
      isLate,
      status: 'submitted',
      marks: null,
      feedback: null,
      gradedAt: null,
      gradedBy: null
    };

    try {
      const res = await fetch('http://localhost:5000/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSubmission)
      });
      if (res.ok) {
        const savedSub = await res.json();
        newSubmission = { ...newSubmission, ...savedSub, id: savedSub.id || savedSub._id || newSubmission.id };
      }
    } catch (e) {
      console.warn('Backend offline, saving submission locally', e);
    }

    setSubmissions(prev => {
      const filtered = prev.filter(s => !(s.assignmentId === assignmentId && s.studentId === studentId));
      return [newSubmission, ...filtered];
    });

    return { success: true, submission: newSubmission, isLate };
  };

  const gradeSubmission = async (submissionId, { marks, feedback, teacherName }) => {
    let updatedSub;

    try {
      const res = await fetch(`http://localhost:5000/api/submissions/${submissionId}/grade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marks: Number(marks), feedback, teacherName })
      });
      if (res.ok) {
        const dbSub = await res.json();
        updatedSub = dbSub;
      }
    } catch (e) {
      console.warn('Backend offline, grading locally', e);
    }

    setSubmissions(prev =>
      prev.map(s => {
        if (s.id === submissionId || s._id === submissionId) {
          const item = updatedSub || {
            ...s,
            marks: Number(marks),
            feedback,
            status: 'graded',
            gradedAt: new Date().toISOString(),
            gradedBy: teacherName || 'Teacher'
          };
          updatedSub = item;
          return item;
        }
        return s;
      })
    );

    return { success: true, submission: updatedSub };
  };

  const createCourse = (courseData) => {
    const newCourse = {
      id: `course-${Date.now()}`,
      ...courseData,
      createdAt: new Date().toISOString()
    };
    setCourses(prev => [...prev, newCourse]);
    return newCourse;
  };

  const updateCourse = (id, updatedFields) => {
    setCourses(prev => prev.map(c => (c.id === id ? { ...c, ...updatedFields } : c)));
  };

  const deleteCourse = (id) => {
    setCourses(prev => prev.filter(c => c.id !== id));
  };

  const createClass = (classData) => {
    const newClass = {
      id: `class-${Date.now()}`,
      ...classData,
      createdAt: new Date().toISOString()
    };
    setClasses(prev => [...prev, newClass]);
    return newClass;
  };

  const updateClass = (id, updatedFields) => {
    setClasses(prev => prev.map(c => (c.id === id ? { ...c, ...updatedFields } : c)));
  };

  const deleteClass = (id) => {
    setClasses(prev => prev.filter(c => c.id !== id));
  };

  const toggleUserStatus = (userId) => {
    setUsers(prev =>
      prev.map(u => (u.id === userId ? { ...u, status: u.status === 'active' ? 'inactive' : 'active' } : u))
    );
  };

  const deleteUser = (userId) => {
    setUsers(prev => prev.filter(u => u.id !== userId));
  };

  const resetToDemoData = () => {
    setCourses(INITIAL_COURSES);
    setClasses(INITIAL_CLASSES);
    setAssignments(INITIAL_ASSIGNMENTS);
    setSubmissions(INITIAL_SUBMISSIONS);
    localStorage.removeItem('edutrack_courses');
    localStorage.removeItem('edutrack_classes');
    localStorage.removeItem('edutrack_assignments');
    localStorage.removeItem('edutrack_submissions');
  };

  return (
    <AppDataContext.Provider
      value={{
        courses,
        classes,
        assignments,
        submissions,
        createAssignment,
        updateAssignment,
        deleteAssignment,
        submitAssignment,
        gradeSubmission,
        createCourse,
        updateCourse,
        deleteCourse,
        createClass,
        updateClass,
        deleteClass,
        toggleUserStatus,
        deleteUser,
        resetToDemoData
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) throw new Error('useAppData must be used within an AppDataProvider');
  return context;
}
