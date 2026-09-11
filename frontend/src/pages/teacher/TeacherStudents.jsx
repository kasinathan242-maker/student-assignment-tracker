import React, { useState } from 'react';
import { useAppData } from '../../context/AppDataContext';
import { useAuth } from '../../context/AuthContext';
import Badge from '../../components/Badge';

export default function TeacherStudents() {
  const { users } = useAuth();
  const { classes, submissions, assignments } = useAppData();
  const { currentUser } = useAuth();

  const [search, setSearch] = useState('');

  const students = users.filter(u => u.role === 'student');

  const filteredStudents = students.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.email.toLowerCase().includes(search.toLowerCase()) ||
    (s.rollNumber && s.rollNumber.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Class Students</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          View enrolled students and their assignment progress.
        </p>
      </div>

      <div>
        <input
          type="text"
          className="form-input"
          placeholder="Search by student name or roll number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: '350px' }}
        />
      </div>

      <div className="custom-table-container">
        <table className="custom-table">
          <thead>
            <tr>
              <th>Student Details</th>
              <th>Roll Number</th>
              <th>Class Batch</th>
              <th>Submissions Completed</th>
              <th>Average Score</th>
              <th>Standing</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No students enrolled yet. Once students register, they will appear here.
                </td>
              </tr>
            ) : (
              filteredStudents.map(student => {
                const studentSubs = submissions.filter(s => s.studentId === student.id || s.studentId === student._id);
                const gradedSubs = studentSubs.filter(s => s.status === 'graded' && typeof s.marks === 'number');
                const avgScore = gradedSubs.length > 0 
                  ? Math.round(gradedSubs.reduce((acc, curr) => acc + curr.marks, 0) / gradedSubs.length)
                  : null;

              return (
                <tr key={student.id}>
                  <td>
                    <div>
                      <p style={{ fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{student.name}</p>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{student.email}</p>
                    </div>
                  </td>

                  <td>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary)' }}>
                      {student.rollNumber || 'CS2026-N/A'}
                    </span>
                  </td>

                  <td>
                    <span style={{ fontSize: '0.85rem' }}>
                      {student.className || 'MERN-2026-A'}
                    </span>
                  </td>

                  <td>
                    <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                      {studentSubs.length} / {assignments.length} Tasks
                    </span>
                  </td>

                  <td>
                    {avgScore !== null ? (
                      <span style={{ fontSize: '1rem', fontWeight: 800, color: avgScore >= 80 ? '#1D4ED8' : '#D97706' }}>
                        {avgScore}%
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        No grades yet
                      </span>
                    )}
                  </td>

                  <td>
                    {avgScore >= 90 ? (
                      <Badge status="Exemplary" variant="emerald" />
                    ) : avgScore >= 80 ? (
                      <Badge status="Proficient" variant="indigo" />
                    ) : (
                      <Badge status="Good Standing" variant="cyan" />
                    )}
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
