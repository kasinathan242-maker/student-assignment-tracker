# Student Assignment Tracker

A full-stack academic assignment management platform built with React, Node.js, Express, and MongoDB. The system provides dedicated, role-protected portals for Students, Faculty/Teachers, and Administrators/HODs.

---

## Features

### 1. Multi-Role Authentication & Dedicated Dashboards
- **Student Portal**:
  - View published assignments with course, subject, and deadline information.
  - Download teacher-attached problem statements, briefs, or reference documents.
  - Upload PDF coursework submissions.
  - Track submission status and view graded feedback with scores (out of 25 marks).
- **Faculty / Teacher Portal**:
  - Create and publish new assignments with due dates and maximum marks (25).
  - Attach question papers, task specifications, and lab manuals (.pdf, .doc, .docx, .txt, .zip).
  - View student submissions for all courses and classes.
  - Grade coursework with marks, detailed feedback, and faculty signature.
- **Admin / HOD Portal**:
  - Full system oversight of users, assignments, and submissions.
  - Department-wide analytics, user management, and configuration controls.

### 2. File Handling & MongoDB Integration
- Teachers can upload assignment instruction documents right from the assignment creation page.
- Students can upload coursework in PDF format.
- Real-time MongoDB persistence with Mongoose models for `users`, `assignments`, and `submissions`.
- Automatic database seeding with default sample coursework and graded submissions.

---

## Tech Stack

- **Frontend**: React 19, Vite, React Router 7, Vanilla CSS (Design Tokens & Glassmorphism)
- **Backend**: Node.js, Express.js, Mongoose, CORS, Dotenv
- **Database**: MongoDB (Local or MongoDB Atlas)

---

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- MongoDB running locally on `mongodb://127.0.0.1:27017` or a MongoDB Atlas URI

### Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Kasinathan006/student-assignment-tracker.git
   cd student-assignment-tracker
   ```

2. **Backend Setup**:
   ```bash
   cd server
   npm install
   cp .env.example .env
   npm start
   ```
   The backend server runs on `http://localhost:5000`.

3. **Frontend Setup**:
   ```bash
   cd ../frontend
   npm install
   npm run dev
   ```
   The frontend runs on `http://localhost:5173`.

---

## Default Login Credentials

| Role | Email | Password |
|---|---|---|
| Faculty / Teacher | teacher@example.com | password123 |
| Student | student@example.com | password123 |
| Admin / HOD | admin@example.com | password123 |

---

## License

This project is licensed under the MIT License.
