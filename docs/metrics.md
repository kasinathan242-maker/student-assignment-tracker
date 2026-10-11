# Metric definitions

All dashboard and report figures are computed from database records at request time (aggregation pipelines and indexed queries). None are stored or estimated.

**Targeted students** (recipients): active student enrollments in the course, limited to the assignment's sections when sections are selected. Dropped students are excluded.

**Submitted**: recipients whose submission state is submitted, graded or returned. Drafts and withdrawn submissions do not count.

**Late**: submitted work whose current version was received after the late threshold (due + grace, or the student's extension).

**Not submitted / missing**: recipients without a submitted record. They count as _missing_ only once the assignment no longer accepts work (closed, past its close date, or past the deadline under a reject policy); before that they are _not submitted_.

**Completion rate**: submitted ÷ targeted, over published and closed assignments. Archived and draft assignments are excluded.

**Average**: mean of published final scores (after late penalties) as a percentage of maximum points. Unpublished drafts and held grades are excluded from student-facing figures.

**Student dashboard**: _due soon_ means not submitted with an effective deadline in the next 7 days; _to do_ means not started, draft, withdrawn or overdue-but-accepted; _overdue or missing_ means past the effective deadline without a submission.

**Teacher dashboard**: _to grade_ means submissions in the submitted state (no published grade for the current attempt); _missing (30 days)_ uses assignments due in the last 30 days that no longer accept work.

**Admin dashboard**: member counts by role and status; submission counts per day in the organization's time zone (last 30 days); failed sign-ins in the last 24 hours by current members; currently locked accounts; audited administrative record access in the last 30 days. It shows no individual academic records.
