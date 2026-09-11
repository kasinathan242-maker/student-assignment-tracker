const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const User = require('../models/User');

const seedDatabase = async () => {
  try {
    const assignmentCount = await Assignment.countDocuments();
    const submissionCount = await Submission.countDocuments();

    if (assignmentCount > 0 && submissionCount > 0) {
      console.log('MongoDB assignmentDB already contains assignments and submissions.');
      return;
    }

    const teachers = await User.find({ role: 'teacher' });
    const students = await User.find({ role: 'student' });

    const primaryTeacher = teachers[0] || {
      _id: '6aa135a901ca466f4b9a6a58',
      name: 'KASINATHAN M',
      email: 'mohankasinathan06@gmail.com'
    };

    let createdAssignments = [];

    if (assignmentCount === 0) {
      const now = new Date();
      const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const inTwoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const defaultAssignments = [
        {
          title: 'Full Stack REST API Development',
          description: 'Design and develop robust RESTful endpoints with Node.js, Express, and MongoDB including authentication and input validation.',
          instructions: 'Implement GET, POST, PUT, DELETE endpoints for a course catalog. Include unit tests and submit the final documentation in PDF format.',
          courseId: 'c-1',
          courseName: 'Computer Science',
          classId: 'cls-1',
          className: 'Batch A',
          subject: 'CS-301',
          startDate: now,
          dueDate: inSevenDays,
          maxMarks: 25,
          teacherId: primaryTeacher._id.toString(),
          teacherName: primaryTeacher.name,
          priority: 'high',
          attachmentName: 'REST_API_Specification.pdf',
          attachmentUrl: '#',
          status: 'published'
        },
        {
          title: 'Database Normalization & Query Optimization',
          description: 'Analyze real-world relational schemas, convert tables up to BCNF, and write optimized indexing queries.',
          instructions: 'Read the attached problem statement and schema definitions. Write SQL DDL/DML and submit query execution plans.',
          courseId: 'c-1',
          courseName: 'Computer Science',
          classId: 'cls-1',
          className: 'Batch A',
          subject: 'CS-302',
          startDate: now,
          dueDate: inTenDays,
          maxMarks: 25,
          teacherId: primaryTeacher._id.toString(),
          teacherName: primaryTeacher.name,
          priority: 'normal',
          attachmentName: 'DBMS_Lab_Sheet.pdf',
          attachmentUrl: '#',
          status: 'published'
        },
        {
          title: 'Data Structures: AVL Tree & Graph Algorithms',
          description: 'Implement self-balancing binary search trees and Dijkstra shortest path algorithm with time complexity proofs.',
          instructions: 'Provide source code in C++/Java and complete test cases verifying rotations and traversal outputs.',
          courseId: 'c-1',
          courseName: 'Computer Science',
          classId: 'cls-1',
          className: 'Batch A',
          subject: 'CS-303',
          startDate: now,
          dueDate: inTwoWeeks,
          maxMarks: 25,
          teacherId: primaryTeacher._id.toString(),
          teacherName: primaryTeacher.name,
          priority: 'normal',
          attachmentName: 'Data_Structures_Problem_Set.pdf',
          attachmentUrl: '#',
          status: 'published'
        },
        {
          title: 'Operating Systems: Process Synchronization',
          description: 'Solve the classical Dining Philosophers and Producer-Consumer concurrency problems using semaphores and mutex locks.',
          instructions: 'Deliver clean thread-safe code with zero deadlocks. Submit code and output screenshots in a single PDF.',
          courseId: 'c-1',
          courseName: 'Computer Science',
          classId: 'cls-1',
          className: 'Batch A',
          subject: 'CS-304',
          startDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          dueDate: yesterday,
          maxMarks: 25,
          teacherId: primaryTeacher._id.toString(),
          teacherName: primaryTeacher.name,
          priority: 'urgent',
          attachmentName: 'OS_Concurrency_Lab.pdf',
          attachmentUrl: '#',
          status: 'published'
        }
      ];

      createdAssignments = await Assignment.insertMany(defaultAssignments);
      console.log(`Seeded ${createdAssignments.length} assignments into MongoDB assignments collection.`);
    } else {
      createdAssignments = await Assignment.find();
    }

    if (submissionCount === 0 && createdAssignments.length > 0 && students.length > 0) {
      const student1 = students[0];
      const student2 = students[1] || students[0];
      const asgn1 = createdAssignments[0];
      const asgn2 = createdAssignments[1] || createdAssignments[0];

      const defaultSubmissions = [
        {
          assignmentId: asgn1._id.toString(),
          studentId: student1._id.toString(),
          studentName: student1.name,
          studentEmail: student1.email,
          rollNumber: 'CS2026-042',
          fileName: 'REST_API_Mohan_Kasinathan.pdf',
          fileSize: '1.4 MB',
          fileUrl: '#',
          comment: 'Complete API implementation with Swagger documentation and test results.',
          submittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          isLate: false,
          status: 'graded',
          marks: 24,
          feedback: 'Outstanding architecture, clean validation, and well-structured documentation.',
          gradedAt: new Date(),
          gradedBy: primaryTeacher.name
        },
        {
          assignmentId: asgn2._id.toString(),
          studentId: student1._id.toString(),
          studentName: student1.name,
          studentEmail: student1.email,
          rollNumber: 'CS2026-042',
          fileName: 'DBMS_Normalization_Report.pdf',
          fileSize: '2.1 MB',
          fileUrl: '#',
          comment: 'Schema diagrams and query execution explain plans included.',
          submittedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          isLate: false,
          status: 'submitted',
          marks: null,
          feedback: null
        }
      ];

      if (student2._id.toString() !== student1._id.toString()) {
        defaultSubmissions.push({
          assignmentId: asgn1._id.toString(),
          studentId: student2._id.toString(),
          studentName: student2.name,
          studentEmail: student2.email,
          rollNumber: 'CS2026-045',
          fileName: 'REST_API_Submission.pdf',
          fileSize: '1.2 MB',
          fileUrl: '#',
          comment: 'Project completed and tested on local MongoDB instance.',
          submittedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          isLate: false,
          status: 'graded',
          marks: 22,
          feedback: 'Good implementation. Add more edge-case validation for route params next time.',
          gradedAt: new Date(),
          gradedBy: primaryTeacher.name
        });
      }

      await Submission.insertMany(defaultSubmissions);
      console.log(`Seeded ${defaultSubmissions.length} submissions into MongoDB submissions collection.`);
    }
  } catch (err) {
    console.error('Error seeding initial assignmentDB data:', err.message);
  }
};

module.exports = seedDatabase;
