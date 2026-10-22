import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import AssignmentCard from '../../components/AssignmentCard';
import Loader from '../../components/Loader';
import EmptyState from '../../components/EmptyState';

const Assignments = () => {
  const [assignments, setAssignments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 9 });
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [sort, setSort] = useState('deadline');
  const [subjectsList, setSubjectsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAssignments = async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '9',
        sort
      });
      if (search.trim()) params.append('search', search.trim());
      if (subject.trim()) params.append('subject', subject.trim());

      const { data } = await api.get(`/assignments?${params.toString()}`);
      setAssignments(data.assignments);
      setPagination(data.pagination);

      // Collect unique subjects for filter dropdown
      if (subjectsList.length === 0 && data.assignments.length > 0) {
        const subs = Array.from(new Set(data.assignments.map((a) => a.subject)));
        setSubjectsList(subs);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to retrieve assignments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignments(1);
  }, [subject, sort]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchAssignments(1);
  };

  const handleClearFilters = () => {
    setSearch('');
    setSubject('');
    setSort('deadline');
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Course Assignments</h1>
          <p className="page-subtitle">
            Explore active course assignments, monitor remaining submission time, and submit your work.
          </p>
        </div>
      </div>

      <div className="filter-bar">
        <form onSubmit={handleSearchSubmit} className="search-form">
          <div className="search-input-wrapper">
            <svg
              className="search-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="form-input search-input"
              placeholder="Search by assignment title or keyword..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-sm">
            Search
          </button>
        </form>

        <div className="filter-controls">
          <div className="select-wrapper">
            <select
              className="form-input form-select filter-select"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              aria-label="Filter by Subject"
            >
              <option value="">All Subjects</option>
              {subjectsList.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
          </div>

          <div className="select-wrapper">
            <select
              className="form-input form-select filter-select"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort Assignments"
            >
              <option value="deadline">Earliest Deadline</option>
              <option value="-deadline">Latest Deadline</option>
              <option value="createdAt">Newest First</option>
            </select>
          </div>

          {(search || subject || sort !== 'deadline') && (
            <button
              onClick={handleClearFilters}
              className="btn btn-secondary btn-sm"
              title="Reset Filters"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <Loader message="Loading assignments..." />
      ) : error ? (
        <div className="alert alert-error">
          <p>{error}</p>
          <button onClick={() => fetchAssignments(pagination.page)} className="btn btn-secondary btn-sm mt-3">
            Retry
          </button>
        </div>
      ) : assignments.length === 0 ? (
        <EmptyState
          title="No Matching Assignments"
          description={
            search || subject
              ? 'No assignments matched your search criteria. Try modifying your filters.'
              : 'There are currently no assignments available.'
          }
          actionText={search || subject ? 'Clear Filters' : undefined}
          onAction={handleClearFilters}
        />
      ) : (
        <>
          <div className="assignments-grid">
            {assignments.map((assignment) => (
              <AssignmentCard
                key={assignment._id}
                assignment={assignment}
                userRole="student"
              />
            ))}
          </div>

          {pagination.pages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-secondary btn-sm pagination-btn"
                disabled={pagination.page <= 1}
                onClick={() => fetchAssignments(pagination.page - 1)}
              >
                Previous
              </button>
              <span className="pagination-info">
                Page {pagination.page} of {pagination.pages} ({pagination.total} assignments)
              </span>
              <button
                className="btn btn-secondary btn-sm pagination-btn"
                disabled={pagination.page >= pagination.pages}
                onClick={() => fetchAssignments(pagination.page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Assignments;
