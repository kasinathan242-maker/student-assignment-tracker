import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Automated WCAG 2.2 A/AA checks. Fails on "serious" and "critical" violations; lists all of them so a
 * regression is easy to locate. Automated checks catch roughly a third of issues; see
 * docs/accessibility.md for the manual checklist.
 */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  // Best effort: a page that makes no requests after `load` (such as the 404 page) can reach network-idle
  // before this wait starts, and Playwright then never reports it. Fonts must be ready for contrast checks.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = blocking
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join('\n  ')}`,
    )
    .join('\n');
  expect(blocking, `${label} has accessibility violations:\n${summary}`).toEqual([]);
}
