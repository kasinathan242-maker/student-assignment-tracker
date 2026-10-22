import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';
import generateToken from '../utils/generateToken.js';

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, role = 'student', inviteCode } = req.body;

  if (role === 'teacher') {
    if (!inviteCode || inviteCode !== process.env.TEACHER_INVITE_CODE) {
      return res.status(403).json({
        message: 'Invalid teacher invite code'
      });
    }
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(409).json({
      message: 'An account with this email already exists'
    });
  }

  const user = await User.create({
    name,
    email,
    password,
    role
  });

  const token = generateToken(user._id, user.role);

  res.status(201).json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.matchPassword(password))) {
    return res.status(401).json({
      message: 'Invalid email or password'
    });
  }

  const token = generateToken(user._id, user.role);

  res.json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  });
});

export const getMe = asyncHandler(async (req, res) => {
  res.json({
    id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role
  });
});
