# Accessibility

Target: WCAG 2.2 AA.

## Built in

- Semantic landmarks, a skip link, one `h1` per page, breadcrumbs with `aria-current`.
- Every form control has a visible label; hints and errors are linked with `aria-describedby`, invalid fields set `aria-invalid`, and errors use `role="alert"`.
- Radix primitives for dialogs, menus, popovers and tabs (focus trapping, Escape to close, focus return, roving focus).
- Visible focus rings on every interactive element; no positive `tabindex`.
- Status is always written in text (badges say "Late", "Needs revision"), never shown by colour alone.
- Light and dark themes with token pairs checked for AA contrast; the subtle-text token was darkened after axe flagged 4.38:1.
- Charts have an equivalent data table ("Show as table") and are hidden from assistive technology.
- `prefers-reduced-motion` disables transitions; there are no autoplaying animations.
- Live regions announce autosave state, upload progress and score previews; toasts use an announced region.
- The calendar has a month table and a list view; the list view is the default on small screens.

## Automated checks

`apps/web/e2e/public.spec.ts` and `journey.spec.ts` run axe-core (WCAG 2.0, 2.1 and 2.2 A/AA rules) on the landing, sign-in, registration, password reset and 404 pages in both themes, and on the admin dashboard, student dashboard, assignment wizard, student assignment page, submission inbox, grading workspace, calendar and members administration. Serious and critical violations fail the build.

## Manual test checklist (before each release)

1. Complete the student journey (find an assignment, write, upload, submit, read feedback) with the keyboard only.
2. Repeat with a screen reader (NVDA + Firefox, VoiceOver + Safari): check headings, form errors, autosave announcements and dialog titles.
3. Zoom to 200% and to a 320 px-wide viewport: no horizontal scrolling except inside data tables.
4. Windows High Contrast / forced colours: focus and selection remain visible.
5. Check the grading workspace's Alt+Left and Alt+Right navigation with a screen reader running.
