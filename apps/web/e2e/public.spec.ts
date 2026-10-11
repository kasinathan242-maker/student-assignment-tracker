import { expect, test } from '@playwright/test';
import { expectAccessible } from './a11y';

test.describe('public pages', () => {
  for (const [path, heading] of [
    ['/', 'Coursework and feedback, in one place.'],
    ['/login', 'Sign in'],
    ['/register', 'Create your account'],
    ['/forgot-password', 'Reset your password'],
    ['/does-not-exist', 'Page not found'],
  ] as const) {
    test(`${path} renders and is accessible in light and dark themes`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expectAccessible(page, `${path} (light)`);
      // System dark mode with reduced motion, so colour transitions do not skew the measurement.
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await page.reload();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await expectAccessible(page, `${path} (dark)`);
    });
  }

  test('keyboard users can reach the sign-in form and submit it', async ({ page }) => {
    await page.goto('/login/student');
    const email = page.getByLabel('Email');
    for (let i = 0; i < 5 && !(await email.evaluate((el) => el === document.activeElement)); i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(email).toBeFocused();
    await page.keyboard.type('nobody@example.edu');
    await page.keyboard.press('Tab');
    await page.keyboard.type('a wrong passphrase');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  });

  // Email confirmation is off by default: a new account is signed in at once, and an existing email gets a
  // generic message without its password being replaced (no account enumeration, no takeover).
  for (const [email, outcome] of [
    ['newcomer@e2e.test', 'signed in'],
    ['platform@e2e.test', 'not signed in'],
  ] as const) {
    test(`registering ${email} without email confirmation: ${outcome}`, async ({ page }) => {
      await page.goto('/register');
      await page.getByLabel('Full name').fill('Someone New');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel(/^Password/).fill('a long unique passphrase');
      await page.getByLabel('Confirm password').fill('a long unique passphrase');
      await page.getByRole('button', { name: 'Create account' }).click();
      if (outcome === 'signed in') {
        await expect(page).toHaveURL(/\/join$/);
        await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
      } else {
        await expect(page.getByRole('alert')).toContainText('could not sign you in');
        await expect(page).toHaveURL(/\/register$/);
      }
    });
  }

  test('there are separate Student, Teacher and HOD / Admin logins, each for its own role', async ({
    page,
  }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: /Student login/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Teacher login/ })).toBeVisible();
    await page.getByRole('link', { name: /HOD \/ Admin login/ }).click();
    await expect(page).toHaveURL(/\/login\/admin$/);
    await expect(page.getByRole('heading', { name: 'HOD / Admin login' })).toBeVisible();
    // The platform administrator is refused at the Student login and pointed to the right one.
    await page.goto('/login/student');
    await page.getByLabel('Email').fill('platform@e2e.test');
    await page.getByLabel('Password').fill('platform e2e passphrase');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Use the HOD / Admin login');
    await expect(page).toHaveURL(/\/login\/student$/);
  });

  test('reflected redirect targets cannot leave the site', async ({ page }) => {
    await page.goto('/login/admin?next=//evil.example/steal');
    await page.getByLabel('Email').fill('platform@e2e.test');
    await page.getByLabel('Password').fill('platform e2e passphrase');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/^http:\/\/localhost:5174\//);
  });
});
