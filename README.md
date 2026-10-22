# Student Assignment Tracker

A complete, production-ready full-stack MERN application for academic course management, assignment lifecycle tracking, automated deadline computation, submission receipts, and rubric-based grading.

---

## 1. Project Overview

Student Assignment Tracker solves academic submission and grading friction by providing:
- **Zero-Ambiguity Deadlines**: Dynamic countdown calculations that differentiate between "Due today", "Due tomorrow", "N days remaining", and "Overdue by N days".
- **Audited Lifecycle State**: Assignments dynamically derive their status (`pending`, `overdue`, `submitted`, `submitted_late`, `reviewed`) without storing stale state in the database.
- **Fair Resubmission Policy**: Students can revise and update their submission prior to instructor review. Once reviewed and graded, submissions are immutably locked.
- **Dual-Perspective Role Security**: Strict server-side role validation preventing privilege escalation. Instructors register only via an authorized institutional invite code.

---

## 2. Features by Role

### For Students
- **Aggregated Performance Dashboard**: Immediate metrics for total coursework, pending tasks, overdue alerts, on-time vs. late submissions, and cumulative graded percentage.
- **Filterable Assignment Catalog**: Search across titles and subjects, sort by earliest/latest deadline or creation date, and view live status badges with countdown timers.
- **Interactive Submission Workspace**: Submit verifiable public links (GitHub, Google Drive, etc.) with optional student notes. Resubmit updates freely before review. Receives proactive late submission warning banners if submitting past deadline.
- **Submission History Ledger**: Tabular audit of every submission, timestamp, on-time/late indicator, numerical score (`marks / maxMarks`), and qualitative instructor feedback.

### For Teachers (Instructors)
- **Instructional Command Center**: Real-time counters for active assignments, total submissions received, pending reviews requiring grading, enrolled student count, and next 5 upcoming deadlines.
- **Assignment Authoring Wizard**: Create and edit course assignments with title character bounds, subject classification, point maximums (1–1000), and future-dated deadline enforcement.
- **Submission Inbox & Grading Workspace**: View all submissions for an assignment with one-click URL access, timing indicators, and inline rubric evaluation dialogs for marks and detailed feedback.
- **Unsubmitted Roster Tracking**: Automated identification of enrolled students who have not yet turned in work for any given assignment.
- **Cascading Deletions**: Deleting an assignment cleanly purges all associated submissions in a single operation.

---

## 3. Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Backend** | Node.js 20+, Express 4, Mongoose 8, ES Modules (`"type": "module"`) |
| **Authentication & Security** | JWT (jsonwebtoken), bcryptjs, Helmet, CORS, Express-Validator |
| **Database** | MongoDB (Local replica set or MongoDB Atlas) |
| **Frontend** | React 18, Vite, React Router DOM v6, Axios |
| **Styling** | Vanilla CSS (CSS variables, responsive flexbox/grid, glassmorphism, no UI library dependencies) |
| **Typography** | Plus Jakarta Sans & JetBrains Mono (via Google Fonts) |

---

## 4. Folder Structure

```
student-assignment-tracker/
├── README.md
├── .gitignore
├── backend/
│   ├── config/
│   │   └── db.js
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── assignmentController.js
│   │   ├── submissionController.js
│   │   └── dashboardController.js
│   ├── middleware/
│   │   ├── authMiddleware.js
│   │   ├── roleMiddleware.js
│   │   ├── validate.js
│   │   └── errorHandler.js
│   ├── models/
│   │   ├── User.js
│   │   ├── Assignment.js
│   │   └── Submission.js
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── assignmentRoutes.js
│   │   ├── submissionRoutes.js
│   │   └── dashboardRoutes.js
│   ├── utils/
│   │   ├── asyncHandler.js
│   │   ├── generateToken.js
│   │   └── status.js
│   ├── seed.js
│   ├── .env.example
│   ├── package.json
│   └── server.js
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── Navbar.jsx
    │   │   ├── AssignmentCard.jsx
    │   │   ├── DashboardCard.jsx
    │   │   ├── ProtectedRoute.jsx
    │   │   ├── StatusBadge.jsx
    │   │   ├── Loader.jsx
    │   │   └── EmptyState.jsx
    │   ├── context/
    │   │   └── AuthContext.jsx
    │   ├── pages/
    │   │   ├── Home.jsx
    │   │   ├── Login.jsx
    │   │   ├── Register.jsx
    │   │   ├── NotFound.jsx
    │   │   ├── student/
    │   │   │   ├── StudentDashboard.jsx
    │   │   │   ├── Assignments.jsx
    │   │   │   ├── AssignmentDetails.jsx
    │   │   │   └── MySubmissions.jsx
    │   │   └── teacher/
    │   │       ├── TeacherDashboard.jsx
    │   │       ├── CreateAssignment.jsx
    │   │       ├── EditAssignment.jsx
    │   │       ├── ManageAssignments.jsx
    │   │       └── Submissions.jsx
    │   ├── services/
    │   │   └── api.js
    │   ├── utils/
    │   │   └── deadline.js
    │   ├── styles/
    │   │   └── global.css
    │   ├── App.jsx
    │   └── main.jsx
    ├── .env.example
    ├── index.html
    ├── package.json
    └── vite.config.js
```

---

## 5. Status Logic Explanation

Assignment statuses are derived dynamically on-the-fly (`backend/utils/status.js`, mirrored on frontend `frontend/src/utils/deadline.js`). "Pending" or "Overdue" states are **never statically written to the database**, ensuring zero stale status bugs when deadlines pass:

| Derived Status | Condition |
| :--- | :--- |
| `pending` | No submission exists AND current time $\le$ assignment deadline |
| `overdue` | No submission exists AND current time $>$ assignment deadline |
| `submitted` | Submission exists, `isLate === false`, AND `status === "submitted"` |
| `submitted_late` | Submission exists, `isLate === true`, AND `status === "submitted"` |
| `reviewed` | Submission exists AND `status === "reviewed"` (marks & feedback assigned) |

### Remaining Time Calculation Rules
- If now $>$ deadline: `"Overdue by N days"` or `"Overdue by N hours"`
- If same calendar day: `"Due today"`
- If next calendar day: `"Due tomorrow"`
- If under 24 hours: `"N hours remaining"`
- Otherwise: `"N days remaining"`

---

## 6. API Reference

All endpoints are prefixed with `/api` and return standardized JSON objects.

### Authentication (`/api/auth`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | Register student or teacher (teacher requires valid `inviteCode`) |
| `POST` | `/api/auth/login` | Public | Authenticate user; returns JWT token and user profile |
| `GET` | `/api/auth/me` | Authenticated | Retrieve current authenticated user profile |

### Assignments (`/api/assignments`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/assignments` | Authenticated | Query assignments (`search`, `subject`, `sort`, `page`, `limit`). Students receive derived statuses; teachers receive authored assignments and submission counts. |
| `GET` | `/api/assignments/:id` | Authenticated | Get assignment details. For students, embeds their own submission record. |
| `POST` | `/api/assignments` | Teacher | Author a new assignment. Deadline must be in the future. |
| `PUT` | `/api/assignments/:id` | Teacher (Owner) | Modify assignment details. Only author can update. |
| `DELETE` | `/api/assignments/:id` | Teacher (Owner) | Delete assignment and cascade-delete all its submissions. |

### Submissions (`/api/submissions`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/submissions` | Student | Submit work (`assignmentId`, `submissionLink`, `comments`). Updates existing submission if unreviewed; rejects with 400 if already reviewed. |
| `GET` | `/api/submissions/my` | Student | Retrieve student's submission history populated with assignment details. |
| `GET` | `/api/submissions/assignment/:id` | Teacher (Owner) | Retrieve all submissions for the assignment plus roster of unsubmitted students. |
| `PUT` | `/api/submissions/:id/review` | Teacher (Owner) | Grade submission (`marks`, `feedback`). Marks enforced $0 \le marks \le maxMarks$. |

### Dashboard & System
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/dashboard/student` | Student | Summary counters: total, pending, overdue, submitted, late, reviewed, avg score. |
| `GET` | `/api/dashboard/teacher` | Teacher | Instructor metrics: total assignments, students, submissions, pending reviews, upcoming deadlines. |
| `GET` | `/api/health` | Public | Service health probe returning `{ "status": "ok" }`. |

---

## 7. Setup & Execution Guide

### Prerequisites
- Node.js 20+
- MongoDB instance (e.g., local MongoDB on `127.0.0.1:27017` or MongoDB Atlas URI)

### Step 1: Configure Environment Variables

**Backend (`backend/.env`):**
```bash
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/assignment_tracker
JWT_SECRET=super_secret_production_ready_jwt_key_983749283749
JWT_EXPIRES_IN=7d
CLIENT_URL=http://localhost:5173
TEACHER_INVITE_CODE=TEACHER2026
```

**Frontend (`frontend/.env`):**
```bash
VITE_API_URL=http://localhost:5000/api
```

### Step 2: Install Dependencies

```bash
# In backend/
cd backend
npm install

# In frontend/
cd ../frontend
npm install
```

### Step 3: Seed Database

```bash
cd backend
npm run seed
```

This clears old records and seeds:
- 1 Teacher: `teacher@demo.com` / `teacher123`
- 3 Students: `student1@demo.com`, `student2@demo.com`, `student3@demo.com` / `student123`
- 5 Assignments with past and future deadlines
- Submissions illustrating every lifecycle status (`pending`, `overdue`, `submitted`, `submitted_late`, `reviewed`)

### Step 4: Run Development Servers

**Terminal 1 (Backend API on :5000):**
```bash
cd backend
npm run dev
```

**Terminal 2 (Frontend Client on :5173):**
```bash
cd frontend
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 8. Demo Credentials

| Role | Email | Password | Details |
| :--- | :--- | :--- | :--- |
| **Instructor** | `teacher@demo.com` | `teacher123` | Can create assignments, view submission inbox, grade, and review. |
| **Student 1** | `student1@demo.com` | `student123` | Alice: Has on-time submission and graded review. |
| **Student 2** | `student2@demo.com` | `student123` | Bob: Has late submission and graded review. |
| **Student 3** | `student3@demo.com` | `student123` | Charlie: Has pending and overdue assignments with no submissions yet. |
