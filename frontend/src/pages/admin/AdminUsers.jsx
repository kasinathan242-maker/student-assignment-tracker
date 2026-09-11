import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Badge from '../../components/Badge';
import { formatDate } from '../../utils/dateUtils';

export default function AdminUsers() {
  const { users, currentUser, updateUser, deleteUser } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('all');

  const filteredUsers = users.filter(u => {
    const matchesSearch = (u.name || '').toLowerCase().includes(search.toLowerCase()) ||
                          (u.email || '').toLowerCase().includes(search.toLowerCase());
    const matchesRole = filterRole === 'all' || u.role === filterRole;
    return matchesSearch && matchesRole;
  });

  const handleToggleStatus = (u) => {
    const newStatus = u.status === 'inactive' ? 'active' : 'inactive';
    updateUser(u.id || u._id, { status: newStatus });
  };

  const handleDelete = (u) => {
    if (window.confirm(`Are you sure you want to remove account for ${u.name}?`)) {
      deleteUser(u.id || u._id);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>
            Department User Management
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Manage all Students, Faculty Teachers, and Administrators enrolled in the department
          </p>
        </div>

        <button className="btn btn-primary" onClick={() => navigate('/register')}>
          + Add New User
        </button>
      </div>

      <div className="glass-card">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <input
            type="text"
            className="form-input"
            placeholder="Search by name or email..."
            style={{ maxWidth: '320px' }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {['all', 'student', 'teacher', 'admin'].map(r => (
              <button
                key={r}
                type="button"
                className={`btn btn-sm ${filterRole === r ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilterRole(r)}
                style={{ textTransform: 'capitalize', fontWeight: 600 }}
              >
                {r === 'all' ? 'All Roles' : (r === 'admin' ? 'HOD / Admins' : `${r}s`)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>User Profile</th>
                <th>Role</th>
                <th>Department</th>
                <th>Status</th>
                <th>Joined</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No users matching criteria.
                  </td>
                </tr>
              ) : (
                filteredUsers.map(u => (
                  <tr key={u.id || u._id}>
                    <td>
                      <p style={{ fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>{u.name}</p>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{u.email}</span>
                    </td>
                    <td>
                      <span style={{
                        textTransform: 'capitalize',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '9999px',
                        background: u.role === 'admin' ? '#EDE9FE' : (u.role === 'teacher' ? '#EFF6FF' : '#ECFDF5'),
                        color: u.role === 'admin' ? '#6D28D9' : (u.role === 'teacher' ? '#1D4ED8' : '#047857')
                      }}>
                        {u.role === 'admin' ? 'HOD Admin' : (u.role === 'teacher' ? 'Teacher' : 'Student')}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      {u.department || 'Computer Science'}
                    </td>
                    <td>
                      <Badge
                        status={u.status === 'inactive' ? 'Inactive' : 'Active'}
                        variant={u.status === 'inactive' ? 'rose' : 'emerald'}
                      />
                    </td>
                    <td style={{ fontSize: '0.825rem', color: 'var(--text-muted)' }}>
                      {u.createdAt ? formatDate(u.createdAt) : 'Registered'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleToggleStatus(u)}
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                        >
                          {u.status === 'inactive' ? 'Activate' : 'Deactivate'}
                        </button>
                        {u.email !== currentUser?.email && (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(u)}
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
