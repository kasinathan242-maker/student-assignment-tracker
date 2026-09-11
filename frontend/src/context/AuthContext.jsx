import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

try {
  if (localStorage.getItem('edutrack_fresh_clean_v1') !== 'true') {
    localStorage.clear();
    localStorage.setItem('edutrack_fresh_clean_v1', 'true');
  }
} catch (e) {
  console.error('Error checking fresh clean state', e);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('edutrack_user');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Error loading saved user', e);
    }
    return null;
  });

  const [users, setUsers] = useState(() => {
    try {
      const saved = localStorage.getItem('edutrack_all_users');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Error loading all users', e);
    }
    return [];
  });

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('edutrack_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('edutrack_user');
    }
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem('edutrack_all_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    const syncUsersFromBackend = async () => {
      try {
        const res = await fetch('http://localhost:5000/api/auth');
        if (res.ok) {
          const dbUsers = await res.json();
          if (Array.isArray(dbUsers)) {
            setUsers(dbUsers);
          }
        }
      } catch (e) {
      }
    };
    syncUsersFromBackend();
  }, []);

  const login = async (email, password) => {
    const cleanEmail = email.trim().toLowerCase();
    try {
      const res = await fetch('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password })
      });
      if (res.ok) {
        const data = await res.json();
        const user = data.user;
        setCurrentUser(user);
        return { success: true, user };
      } else {
        const errData = await res.json();
        if (errData?.message) return { success: false, message: errData.message };
      }
    } catch (err) {
      console.warn('Backend login unavailable, checking local accounts', err);
    }

    const found = users.find(u => u.email.toLowerCase() === cleanEmail);
    if (!found) {
      return { success: false, message: 'User with this email was not found.' };
    }
    if (found.status === 'inactive') {
      return { success: false, message: 'Your account has been deactivated.' };
    }
    setCurrentUser(found);
    return { success: true, user: found };
  };

  const loginAsRole = async (role) => {
    let target = users.find(u => u.role === role);
    if (!target) {
      const email = role === 'student' ? 'student@example.com' : (role === 'teacher' ? 'teacher@example.com' : 'admin@example.com');
      const res = await login(email, '123456');
      if (res.success) return res.user;
    }
    if (target) {
      setCurrentUser(target);
      return target;
    }
    return null;
  };

  const deleteUser = async (userId) => {
    try {
      await fetch(`http://localhost:5000/api/auth/${userId}`, { method: 'DELETE' });
    } catch (e) {
      console.warn('Backend offline, deleting locally', e);
    }
    setUsers(prev => prev.filter(u => u.id !== userId && u._id !== userId));
  };

  const updateUser = async (userId, fields) => {
    setUsers(prev => prev.map(u => (u.id === userId || u._id === userId ? { ...u, ...fields } : u)));
    if (currentUser && (currentUser.id === userId || currentUser._id === userId)) {
      setCurrentUser(prev => ({ ...prev, ...fields }));
    }
    try {
      await fetch(`http://localhost:5000/api/auth/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      });
    } catch (e) {
      console.warn('Could not sync user update with backend', e);
    }
  };

  const register = async (userData) => {
    const cleanEmail = userData.email.trim().toLowerCase();

    try {
      const res = await fetch('http://localhost:5000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: userData.name,
          email: cleanEmail,
          password: userData.password,
          role: userData.role || 'student',
          department: userData.department || 'Computer Science'
        })
      });

      if (res.ok) {
        const savedUser = await res.json();
        setUsers(prev => [savedUser, ...prev.filter(u => u.email !== savedUser.email)]);
        setCurrentUser(savedUser);
        return { success: true, user: savedUser };
      } else {
        const errData = await res.json();
        if (errData?.message) return { success: false, message: errData.message };
      }
    } catch (err) {
      console.warn('Backend register unavailable, saving locally', err);
    }

    const existing = users.find(u => u.email.toLowerCase() === cleanEmail);
    if (existing) {
      return { success: false, message: 'Email address is already registered.' };
    }

    const newUser = {
      id: `user-${Date.now()}`,
      name: userData.name,
      email: cleanEmail,
      role: userData.role || 'student',
      status: 'active',
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userData.name)}`,
      rollNumber: userData.role === 'student' ? `CS2026-${Math.floor(100 + Math.random() * 900)}` : undefined,
      department: userData.department || 'Computer Science',
      classId: userData.classId || 'class-1',
      className: 'Batch A',
      createdAt: new Date().toISOString()
    };

    const updated = [...users, newUser];
    setUsers(updated);
    setCurrentUser(newUser);
    return { success: true, user: newUser };
  };

  const logout = () => {
    setCurrentUser(null);
  };

  const updateUserProfile = async (updatedFields) => {
    if (!currentUser) return;
    const updated = { ...currentUser, ...updatedFields };
    setCurrentUser(updated);
    setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));

    try {
      const uid = currentUser._id || currentUser.id;
      if (uid) {
        await fetch(`http://localhost:5000/api/auth/${uid}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedFields)
        });
      }
    } catch (e) {
      console.warn('Could not sync profile update with backend', e);
    }
  };

  return (
    <AuthContext.Provider value={{
      currentUser,
      users,
      setUsers,
      isAuthenticated: !!currentUser,
      role: currentUser?.role || null,
      login,
      loginAsRole,
      register,
      logout,
      updateUserProfile,
      updateUser,
      deleteUser
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
