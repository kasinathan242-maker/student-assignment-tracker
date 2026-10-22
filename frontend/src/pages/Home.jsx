import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Home = () => {
  const { user, isAuthenticated } = useAuth();

  return (
    <div className="home-page">
      <section className="hero-section">
        <div className="hero-glow"></div>
        <div className="hero-content">
          <div className="hero-badge">
            <span className="hero-badge-dot"></span>
            Academic Workflow Engine
          </div>
          <h1 className="hero-title">
            Streamlined Assignment Management for Higher Education
          </h1>
          <p className="hero-subtitle">
            An institutional platform connecting students and educators. Real-time
            deadline intelligence, verified submissions, transparent rubric evaluation,
            and automated status auditing.
          </p>

          <div className="hero-actions">
            {isAuthenticated ? (
              <Link
                to={user?.role === 'teacher' ? '/teacher' : '/student'}
                className="btn btn-primary btn-lg"
              >
                Go to {user?.role === 'teacher' ? 'Instructor' : 'Student'} Dashboard
              </Link>
            ) : (
              <>
                <Link to="/register" className="btn btn-primary btn-lg">
                  Get Started Free
                </Link>
                <Link to="/login" className="btn btn-secondary btn-lg">
                  Sign In to Portal
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="features-section">
        <div className="section-header">
          <h2 className="section-title">Engineered for Academic Rigor</h2>
          <p className="section-subtitle">
            Tailored toolsets for students tracking coursework and teachers orchestrating curricula.
          </p>
        </div>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon feature-student">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                <path d="M6 12v5c3 3 9 3 12 0v-5" />
              </svg>
            </div>
            <h3 className="feature-title">For Students</h3>
            <p className="feature-text">
              Track deadlines with dynamic time countdowns. Submit verifiable links, resubmit revisions prior to grading, and review detailed instructor feedback.
            </p>
            <ul className="feature-list">
              <li>Automatic pending & overdue status derivation</li>
              <li>Pre-deadline revision & resubmission capabilities</li>
              <li>Transparent marks and rubric feedback ledger</li>
            </ul>
          </div>

          <div className="feature-card">
            <div className="feature-icon feature-teacher">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <h3 className="feature-title">For Instructors</h3>
            <p className="feature-text">
              Design course assignments with strict deadline enforcement. Audit submission inboxes with automated non-submission tracking and inline grade reviews.
            </p>
            <ul className="feature-list">
              <li>Protected assignment wizard with future deadline guards</li>
              <li>Automatic unsubmitted student identification</li>
              <li>Instant grading, feedback notes, and score limits</li>
            </ul>
          </div>

          <div className="feature-card">
            <div className="feature-icon feature-system">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3 className="feature-title">Security & Integrity</h3>
            <p className="feature-text">
              Stateless JWT authentication, bcrypt salted credentials, teacher access controls via secret invite verification, and isolated tenant permissions.
            </p>
            <ul className="feature-list">
              <li>Teacher registration gated by invite authorization</li>
              <li>Unique compound indices preventing duplicate submissions</li>
              <li>Zero unhandled rejections with central error mapping</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="credentials-section">
        <div className="credentials-card">
          <div className="credentials-header">
            <h3>Quick Evaluation Logins</h3>
            <span className="credentials-pill">Seeded Demo Data</span>
          </div>
          <p className="credentials-subtext">
            Use these pre-configured credentials to test all roles immediately:
          </p>
          <div className="credentials-grid">
            <div className="cred-box">
              <span className="cred-role role-teacher">Instructor</span>
              <p className="cred-email">teacher@demo.com</p>
              <p className="cred-pass">teacher123</p>
            </div>
            <div className="cred-box">
              <span className="cred-role role-student">Student 1</span>
              <p className="cred-email">student1@demo.com</p>
              <p className="cred-pass">student123</p>
            </div>
            <div className="cred-box">
              <span className="cred-role role-student">Student 2</span>
              <p className="cred-email">student2@demo.com</p>
              <p className="cred-pass">student123</p>
            </div>
            <div className="cred-box">
              <span className="cred-role role-student">Student 3</span>
              <p className="cred-email">student3@demo.com</p>
              <p className="cred-pass">student123</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
