import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { expectAccessible } from './a11y';

/**
 * Full journey across roles with real frontend, API, worker and database. Steps share state and run in
 * order. Numbers in test titles refer to the required end-to-end scenarios.
 */
const API = 'http://localhost:4100/api/v1';
const PASSWORD = 'e2e journey passphrase';
const PLATFORM = { email: 'platform@e2e.test', password: 'platform e2e passphrase' };
const people = {
  admin: 'admin@e2e.test',
  teacher: 'teacher@e2e.test',
  s1: 'student.one@e2e.test',
  s2: 'student.two@e2e.test',
  admin2: 'admin@other.test',
};
const state: { orgId?: string; org2Id?: string; assignmentUrl?: string } = {};
const pages: Partial<Record<keyof typeof people, Page>> = {};

/** Follows a link from the development mailbox, waiting for the worker to deliver it. */
async function emailLink(request: APIRequestContext, to: string, pathPart: string): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    const res = await request.get(`${API}/dev/mail?to=${encodeURIComponent(to)}`);
    const mail = (await res.json()) as { text: string }[];
    for (const m of mail) {
      const match = m.text.match(new RegExp(`(http://localhost:5174${pathPart}#token=[A-Za-z0-9_%-]+)`));
      if (match?.[1]) return match[1];
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`No email to ${to} containing ${pathPart}`);
}

async function signIn(
  page: Page,
  email: string,
  password = PASSWORD,
  portal: 'student' | 'teacher' | 'admin' = 'student',
) {
  await page.goto(`/login/${portal}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function registerFromInvite(
  browser: Browser,
  request: APIRequestContext,
  email: string,
  name: string,
): Promise<Page> {
  const link = await emailLink(request, email, '/accept-invite');
  const page = await (await browser.newContext({ timezoneId: 'Asia/Kolkata' })).newPage();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Create your account', exact: true })).toBeVisible();
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account and join' }).click();
  await expect(page).toHaveURL(/\/o\/[a-f0-9]{24}/);
  return page;
}

/** Wall-clock "YYYY-MM-DDTHH:mm" in Asia/Kolkata for a datetime-local input. */
function kolkataLocal(msFromNow: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + msFromNow));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

test.describe.serial('student assignment journey', () => {
  test('platform administrator creates an organization and its admin joins by invitation', async ({
    browser,
    request,
  }) => {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, PLATFORM.email, PLATFORM.password, 'admin');
    await expect(page.getByRole('heading', { name: 'Organizations', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New organization' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('E2E College');
    await dialog.getByLabel('Identifier').fill('e2e-college');
    await dialog.getByLabel('Administrator email').fill(people.admin);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('cell', { name: 'E2E College' })).toBeVisible();

    pages.admin = await registerFromInvite(browser, request, people.admin, 'Asha Admin');
    await expect(
      pages.admin.getByRole('heading', { name: 'Organization overview', exact: true }),
    ).toBeVisible();
    state.orgId = pages.admin.url().match(/\/o\/([a-f0-9]{24})/)?.[1];
    await expectAccessible(pages.admin, 'admin dashboard');
    await page.context().close();
  });

  test('1–2: teacher and students join through invitations and sign in', async ({ browser, request }) => {
    const admin = pages.admin as Page;
    for (const [email, role] of [
      [people.teacher, 'Teacher'],
      [people.s1, 'Student'],
      [people.s2, 'Student'],
    ] as const) {
      await admin.goto(`/o/${state.orgId}/admin/invitations`);
      await admin.getByRole('button', { name: 'Invite' }).click();
      const dialog = admin.getByRole('dialog');
      await dialog.getByLabel('Email').fill(email);
      await dialog.getByLabel('Role').selectOption({ label: role });
      await dialog.getByRole('button', { name: 'Send invitation' }).click();
      await expect(admin.getByRole('cell', { name: email })).toBeVisible();
    }
    pages.teacher = await registerFromInvite(browser, request, people.teacher, 'Tara Teacher');
    pages.s1 = await registerFromInvite(browser, request, people.s1, 'Sam Student');
    pages.s2 = await registerFromInvite(browser, request, people.s2, 'Riya Student');
    await expect(
      pages.s1.getByRole('heading', { name: /Good (morning|afternoon|evening), Sam/ }),
    ).toBeVisible();

    // Explicit sign-in in a fresh browser works too.
    const fresh = await (await browser.newContext()).newPage();
    await signIn(fresh, people.s1);
    await expect(fresh).toHaveURL(new RegExp(`/o/${state.orgId}`));
    await expectAccessible(fresh, 'student dashboard');
    await fresh.context().close();
  });

  test('3–4: instructor creates a course and enrolls students', async () => {
    const teacher = pages.teacher as Page;
    await teacher.goto(`/o/${state.orgId}/courses`);
    await teacher.getByRole('button', { name: 'New course' }).click();
    const dialog = teacher.getByRole('dialog');
    await dialog.getByLabel('Course code').fill('E2E101');
    await dialog.getByLabel('Term').fill('2026 Monsoon');
    await dialog.getByLabel('Title').fill('End-to-End Testing');
    await dialog.getByRole('button', { name: 'Create course' }).click();
    await teacher.getByRole('link', { name: /E2E101/ }).click();
    await teacher.getByRole('tab', { name: 'Roster' }).click();
    for (const email of [people.s1, people.s2]) {
      await teacher.getByRole('button', { name: 'Add people' }).click();
      const add = teacher.getByRole('dialog');
      await add.getByLabel('Email').fill(email);
      await add.getByRole('button', { name: 'Add' }).click();
      await expect(teacher.getByRole('cell', { name: email })).toBeVisible();
    }
  });

  test('5: instructor creates and publishes an assignment', async () => {
    const teacher = pages.teacher as Page;
    await teacher.goto(`/o/${state.orgId}/assignments/new`);
    await teacher.getByLabel('Course').selectOption({ label: 'E2E101 · End-to-End Testing' });
    await teacher.getByLabel('Title').fill('Reflection on testing');
    await teacher.getByLabel('Points').fill('10');
    await teacher.getByRole('button', { name: 'Next' }).click();
    await teacher.getByLabel(/^Due/).fill(kolkataLocal(50 * 60_000));
    await teacher.getByRole('button', { name: 'Next' }).click();
    await teacher.getByLabel('A written response').check();
    await teacher.getByRole('checkbox', { name: 'Files', exact: true }).uncheck();
    await teacher.getByLabel('Allow resubmission').check();
    await teacher.getByLabel('Maximum attempts').fill('2');
    await teacher.getByLabel('Allow extension requests').check();
    await teacher.getByRole('button', { name: 'Next' }).click();
    await expectAccessible(teacher, 'assignment wizard review step');
    await teacher.getByRole('button', { name: 'Publish' }).click();
    await expect(teacher.getByRole('heading', { name: /Reflection on testing/ })).toBeVisible();
    await expect(teacher.getByText('Published', { exact: true })).toBeVisible();
    state.assignmentUrl = new URL(teacher.url()).pathname;
  });

  test('6–9: student sees it, saves a draft and submits with a durable receipt', async () => {
    const s1 = pages.s1 as Page;
    await s1.goto(`/o/${state.orgId}/assignments`);
    await s1.getByRole('link', { name: 'Reflection on testing' }).click();
    await expectAccessible(s1, 'student assignment page');
    await s1.getByLabel('Written response').fill('Integration tests caught a timezone bug before release.');
    await expect(s1.getByText(/Draft saved .* ago/)).toBeVisible();
    await s1.reload();
    await expect(s1.getByLabel('Written response')).toHaveValue(/timezone bug/);
    await s1.getByRole('button', { name: 'Submit', exact: true }).click();
    await s1.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
    await expect(s1.getByRole('heading', { name: 'Submission receipt', exact: true })).toBeVisible();
    await expect(s1.getByText(/^SAT-[A-Z0-9]{4}-[A-Z0-9]{4}$/)).toBeVisible();
    await expect(s1.getByText('Your work was submitted.')).toBeVisible();
  });

  test('14: a deadline reminder is created by the worker', async () => {
    const s2 = pages.s2 as Page;
    await expect(async () => {
      await s2.goto('/notifications');
      await expect(s2.getByText(/Due in 1 hour: Reflection on testing/)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  });

  test('10–13: instructor reviews, grades, publishes; student sees the released grade', async () => {
    const teacher = pages.teacher as Page;
    await teacher.goto(`${state.assignmentUrl}/submissions`);
    const row = teacher.getByRole('row', { name: /Sam Student/ });
    await expect(row.getByText('Submitted')).toBeVisible();
    await expectAccessible(teacher, 'submission inbox');
    await row.getByRole('link', { name: 'Grade' }).click();
    await expect(teacher.getByLabel('Points')).toBeVisible();
    await expectAccessible(teacher, 'grading workspace');
    await expect(teacher.getByText('Integration tests caught a timezone bug before release.')).toBeVisible();
    await teacher.getByLabel('Points').fill('8');
    await teacher
      .getByLabel('Feedback for the student')
      .fill('Clear example. Add how you prevented regressions.');
    await teacher.getByRole('button', { name: 'Save draft' }).click();
    await expect(teacher.getByText('You have unpublished changes.')).toBeVisible();

    // The draft is invisible to the student.
    const s1 = pages.s1 as Page;
    await s1.goto(state.assignmentUrl as string);
    await expect(s1.getByRole('heading', { name: 'Grade and feedback', exact: true })).toHaveCount(0);

    await teacher.getByRole('button', { name: 'Publish grade' }).click();
    await teacher.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
    await expect(teacher.getByText(/Published\. Edits create a correction/)).toBeVisible();

    await s1.reload();
    await expect(s1.getByRole('heading', { name: 'Grade and feedback', exact: true })).toBeVisible();
    await expect(s1.getByText('8 / 10')).toBeVisible();
    await expect(s1.getByText('Clear example. Add how you prevented regressions.')).toBeVisible();
  });

  test('20: an approved extension changes the student’s deadline everywhere', async () => {
    const s2 = pages.s2 as Page;
    await s2.goto(state.assignmentUrl as string);
    await s2.getByRole('button', { name: 'Request an extension' }).click();
    const dialog = s2.getByRole('dialog');
    await dialog.getByLabel('New due date and time').fill(kolkataLocal(3 * 86_400_000));
    await dialog.getByLabel('Reason').fill('Family emergency this week.');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(s2.getByText('pending')).toBeVisible();

    const teacher = pages.teacher as Page;
    await teacher.goto(`/o/${state.orgId}/extensions`);
    await teacher.getByRole('button', { name: 'Approve' }).click();
    await teacher.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(teacher.getByText('No requests')).toBeVisible();
    await teacher.goto(`/o/${state.orgId}/calendar`);
    await expectAccessible(teacher, 'calendar');
    await (pages.admin as Page).goto(`/o/${state.orgId}/admin/members`);
    await expectAccessible(pages.admin as Page, 'members admin');

    await s2.reload();
    await expect(s2.getByText(/Extended for you/)).toBeVisible();
    await teacher.goto(`${state.assignmentUrl}/submissions`);
    await expect(teacher.getByRole('row', { name: /Riya Student/ }).getByText(/Extended to/)).toBeVisible();
  });

  test('19: resubmission follows the assignment’s attempt limit', async () => {
    const s2 = pages.s2 as Page;
    for (const text of ['First attempt.', 'Second attempt, improved.']) {
      await s2.goto(state.assignmentUrl as string);
      await s2.getByLabel('Written response').fill(text);
      await expect(s2.getByText(/Draft saved .* ago/)).toBeVisible();
      await s2
        .getByRole('button', { name: /^Submit/ })
        .first()
        .click();
      await s2.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
      await expect(s2.getByRole('heading', { name: 'Submission receipt', exact: true })).toBeVisible();
    }
    await s2.goto(state.assignmentUrl as string);
    await expect(s2.getByText('You have used all permitted submission attempts.')).toBeVisible();
    await expect(s2.getByRole('button', { name: 'Submit new attempt' })).toBeDisabled();
  });

  test('15: users without permission are denied, in the UI and the API', async () => {
    const s1 = pages.s1 as Page;
    await s1.goto(`/o/${state.orgId}/admin/members`);
    await expect(s1.getByRole('heading', { name: 'You do not have access', exact: true })).toBeVisible();
    const res = await s1.request.get(`${API}/orgs/${state.orgId}/members`);
    expect(res.status()).toBe(403);
  });

  test('16: a second organization cannot reach the first organization’s data', async ({
    browser,
    request,
  }) => {
    const platform = await (await browser.newContext()).newPage();
    await signIn(platform, PLATFORM.email, PLATFORM.password, 'admin');
    await platform.getByRole('button', { name: 'New organization' }).click();
    const dialog = platform.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Other Institute');
    await dialog.getByLabel('Identifier').fill('other-institute');
    await dialog.getByLabel('Administrator email').fill(people.admin2);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(platform.getByRole('cell', { name: 'Other Institute' })).toBeVisible();
    await platform.context().close();

    const admin2 = await registerFromInvite(browser, request, people.admin2, 'Omar Admin');
    await admin2.goto(`/o/${state.orgId}/courses`);
    await expect(admin2.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible();
    expect((await admin2.request.get(`${API}/orgs/${state.orgId}`)).status()).toBe(404);
    expect((await admin2.request.get(`${API}/orgs/${state.orgId}/assignments`)).status()).toBe(404);
  });

  test('17–18: logout ends the session, and failed sign-in never shows success', async () => {
    const s1 = pages.s1 as Page;
    await s1.goto(`/o/${state.orgId}`);
    await s1.getByRole('button', { name: 'Account menu' }).click();
    await s1.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(s1).toHaveURL(/\/login/);
    expect((await s1.request.get(`${API}/me`)).status()).toBe(401);
    await s1.goto(state.assignmentUrl as string);
    await expect(s1).toHaveURL(/\/login\?next=/);
    await s1.getByRole('link', { name: /Student login/ }).click();
    await expect(s1).toHaveURL(/\/login\/student\?next=/);

    await s1.getByLabel('Email').fill(people.s1);
    await s1.getByLabel('Password').fill('not the right password');
    await s1.getByRole('button', { name: 'Sign in' }).click();
    await expect(s1.getByText('Incorrect email or password.')).toBeVisible();
    await expect(s1).toHaveURL(/\/login/);
  });
});
