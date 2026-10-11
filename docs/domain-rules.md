# Domain rules

The authoritative implementations are in `packages/shared/src/domain` and are covered by unit tests.

## Time

- Instants are stored in UTC. Each assignment has an IANA time zone used to enter its dates; every viewer sees dates in their own profile time zone. Conversions use Luxon, so daylight-saving transitions are handled (tested for the US spring-forward change).
- **The server decides.** A submission is judged at the moment the API _received_ the request (`req.receivedAt`). A request that arrives at 16:59:59 and finishes at 17:00:02 is on time for a 17:00 deadline. Client clocks are never used.
- If the worker is delayed, scheduled publication and auto-close run as soon as it resumes (status-guarded updates make this safe), and reminders never fire after a deadline.

## Deadlines and late work

| Term           | Definition                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effective due  | The student's latest approved extension, otherwise the assignment due date                                                                                                                                                            |
| Late threshold | Effective due + grace period. Submitting exactly at the threshold is on time                                                                                                                                                          |
| Cutoff         | Last accepted instant: the late threshold under "reject"; effective due + grace + max late days under "accept" or "penalize" (no cutoff if unlimited); also capped by the assignment's close date unless the student has an extension |
| Lateness       | Minutes after the effective due (the grace period forgives; it does not move the clock)                                                                                                                                               |
| Penalty        | `penalize`: percentage per started day late, applied to the earned points, never below zero                                                                                                                                           |

Closing an assignment manually stops submissions except for students holding an approved extension. Changing a deadline after publication is recorded in the change history and notifies students. Extensions keep the original due date and full history.

## Assignment lifecycle

`draft → scheduled | published → closed → archived`, with `unschedule`, `reopen` and `restore` (restores to _closed_ if it was ever published, otherwise to _draft_). Students only see published or closed assignments targeted at them (whole course or their section). Points and rubric cannot change after grading starts.

## Submission states

| State     | Meaning                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| (none)    | Not started                                                                        |
| draft     | Saved work, never counted as submitted                                             |
| submitted | A version was submitted (shown as "late" or "resubmitted" from version attributes) |
| returned  | The teacher asked for a revision (always grants one more attempt)                  |
| graded    | A grade was published for the current attempt                                      |
| withdrawn | The student withdrew before the deadline (does not refund an attempt)              |

Resubmission: if disabled, one active submission; if enabled, up to `maxAttempts` (or unlimited). Graded work can only be resubmitted after the teacher returns it. Each final submission creates an immutable version with a receipt code. Students see "overdue" when past due but still accepted, and "missing" when no longer accepted.

## Grading and release

- A grade record has a **draft** and a **published** part. Drafts are never visible to students. Publishing copies the draft; correcting a published grade requires a reason and writes grade history (previous and new values, actor, time, version).
- Rubric scores are validated per criterion and the rubric is **snapshotted** into the grade, so later rubric edits never change past results (rubrics used for grading are locked).
- A rubric-graded assignment scores as the rubric total, so that total must equal the assignment's points. This is enforced when an assignment is created or edited and when a rubric in use is edited (`rubric_points_mismatch`).
- Grading (the submissions inbox and workspace) is for the course's instructors. Organization administrators can manage assignments but do not see student work; the API returns `canGrade` so the app only offers grading to instructors.
- Release modes: _immediate_ (students see each grade when published) or _hold_ (nothing visible until the teacher releases all grades for the assignment). Exports, dashboards and notifications respect visibility.

## Reminders

Default offsets are 24 hours and 1 hour before the effective due date (organization setting; students may override). Only the most specific elapsed offset fires (a delayed worker never sends a stale "due in 24 hours"), nothing fires after the deadline, submitted or graded students are skipped, and the dedupe key includes the offset and the effective due instant, so retries never resend and moved deadlines produce fresh reminders.
