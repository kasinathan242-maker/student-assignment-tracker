import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import User from './models/User.js';
import Assignment from './models/Assignment.js';
import Submission from './models/Submission.js';

if (!process.env.MONGO_URI) {
  console.error('MONGO_URI is required to run the seed script.');
  process.exit(1);
}

const seedDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB for seeding...');

    // Clear existing collections
    await User.deleteMany({});
    await Assignment.deleteMany({});
    await Submission.deleteMany({});
    console.log('Cleared existing users, assignments, and submissions.');

    // 1. Create Teacher
    const teacher = await User.create({
      name: 'Professor Alan Turing',
      email: 'teacher@demo.com',
      password: 'teacher123',
      role: 'teacher'
    });

    // 2. Create Students
    const student1 = await User.create({
      name: 'Alice Smith',
      email: 'student1@demo.com',
      password: 'student123',
      role: 'student'
    });

    const student2 = await User.create({
      name: 'Bob Jones',
      email: 'student2@demo.com',
      password: 'student123',
      role: 'student'
    });

    const student3 = await User.create({
      name: 'Charlie Brown',
      email: 'student3@demo.com',
      password: 'student123',
      role: 'student'
    });

    console.log('Seeded 1 teacher and 3 students.');

    // 3. Create 5 Assignments (mixed past and future deadlines)
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const assignment1 = await Assignment.create({
      title: 'Data Structures: Red-Black Tree Implementation',
      description:
        'Implement a self-balancing binary search tree supporting insert, delete, and search operations with O(log n) guarantees. Include unit tests demonstrating rebalancing and recoloring.',
      subject: 'Computer Science',
      deadline: new Date(now - 7 * day), // Past deadline (7 days ago)
      maxMarks: 100,
      createdBy: teacher._id
    });

    const assignment2 = await Assignment.create({
      title: 'Database Systems: Normalized Schema & Queries',
      description:
        'Design an optimized 3NF relational schema for an e-commerce platform. Provide DDL, indexing strategies, and complex SQL aggregation queries.',
      subject: 'Information Systems',
      deadline: new Date(now - 3 * day), // Past deadline (3 days ago)
      maxMarks: 100,
      createdBy: teacher._id
    });

    const assignment3 = await Assignment.create({
      title: 'Operating Systems: Process Synchronization',
      description:
        'Implement a solution for the Readers-Writers problem using POSIX semaphores and mutex locks. Prevent starvation and avoid deadlocks.',
      subject: 'Computer Science',
      deadline: new Date(now + 2 * day), // Future deadline (in 2 days)
      maxMarks: 50,
      createdBy: teacher._id
    });

    const assignment4 = await Assignment.create({
      title: 'Web Development: Full-Stack REST API',
      description:
        'Build a secure RESTful API service with authentication, rate limiting, and relational or document database integration. Include comprehensive API documentation.',
      subject: 'Software Engineering',
      deadline: new Date(now + 6 * day), // Future deadline (in 6 days)
      maxMarks: 100,
      createdBy: teacher._id
    });

    const assignment5 = await Assignment.create({
      title: 'Cloud Computing: Docker Containerization',
      description:
        'Containerize a multi-tier web application using Docker and Docker Compose. Include health checks, volume persistence, and production-ready alpine images.',
      subject: 'Cloud Technologies',
      deadline: new Date(now + 12 * day), // Future deadline (in 12 days)
      maxMarks: 75,
      createdBy: teacher._id
    });

    console.log('Seeded 5 assignments with past and future deadlines.');

    // 4. Create Submissions covering every status:
    // Status 1: "reviewed" (Alice on Assignment 1 - submitted on time, graded with marks and feedback)
    await Submission.create({
      assignmentId: assignment1._id,
      studentId: student1._id,
      submissionLink: 'https://github.com/alice/red-black-tree',
      comments: 'Full implementation completed with comprehensive rotation test cases.',
      submittedAt: new Date(now - 8 * day),
      isLate: false,
      status: 'reviewed',
      marks: 95,
      feedback: 'Outstanding implementation of rotational balance cases and tree traversal tests.',
      reviewedAt: new Date(now - 6 * day)
    });

    // Status 2: "reviewed" (Bob on Assignment 1 - submitted on time, reviewed)
    await Submission.create({
      assignmentId: assignment1._id,
      studentId: student2._id,
      submissionLink: 'https://github.com/bob/rbtree-assignment',
      comments: 'Repository contains source code and Makefile.',
      submittedAt: new Date(now - 8 * day),
      isLate: false,
      status: 'reviewed',
      marks: 84,
      feedback: 'Solid foundation, though double-black node handling could be refactored.',
      reviewedAt: new Date(now - 5 * day)
    });

    // Status 3: "submitted_late" (Bob on Assignment 2 - submitted after deadline, not reviewed yet)
    await Submission.create({
      assignmentId: assignment2._id,
      studentId: student2._id,
      submissionLink: 'https://github.com/bob/ecommerce-schema',
      comments: 'Submitted shortly after the deadline following schema benchmark validation.',
      submittedAt: new Date(now - 2 * day),
      isLate: true,
      status: 'submitted'
    });

    // Status 4: "submitted" (Alice on Assignment 3 - submitted before future deadline, not reviewed yet)
    await Submission.create({
      assignmentId: assignment3._id,
      studentId: student1._id,
      submissionLink: 'https://github.com/alice/readers-writers-mutex',
      comments: 'Clean POSIX mutex solution ensuring reader priority with starvation prevention.',
      submittedAt: new Date(now - 1 * day),
      isLate: false,
      status: 'submitted'
    });

    // Charlie has NO submission for Assignment 1 or 2 -> Derived Status: "overdue"
    // Charlie has NO submission for Assignment 3, 4, or 5 -> Derived Status: "pending"

    console.log('Seeded submissions covering reviewed, submitted, and submitted_late statuses.');
    console.log('\n==========================================');
    console.log('DEMO ACCOUNTS READY FOR USE');
    console.log('==========================================');
    console.log('TEACHER:');
    console.log('  Email:    teacher@demo.com');
    console.log('  Password: teacher123');
    console.log('------------------------------------------');
    console.log('STUDENTS:');
    console.log('  Email:    student1@demo.com');
    console.log('  Password: student123');
    console.log('');
    console.log('  Email:    student2@demo.com');
    console.log('  Password: student123');
    console.log('');
    console.log('  Email:    student3@demo.com');
    console.log('  Password: student123');
    console.log('==========================================\n');

    await mongoose.disconnect();
    console.log('Seed process completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error during database seed:', error);
    process.exit(1);
  }
};

seedDatabase();
