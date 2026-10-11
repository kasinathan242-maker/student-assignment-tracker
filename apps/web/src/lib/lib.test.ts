import { describe, expect, it } from 'vitest';
import { formatPoints, fromLocalInput, greetingName, setDisplayZone, toLocalInput } from './format';
import { parseReminderHours } from './forms';
import { safeNextPath } from './safeRedirect';

describe('safeNextPath', () => {
  it('allows same-origin paths and rejects open redirects', () => {
    expect(safeNextPath('/o/123/assignments?bucket=pending')).toBe('/o/123/assignments?bucket=pending');
    for (const bad of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '/javascript:alert(1)',
      '',
    ]) {
      expect(safeNextPath(bad), bad).toBe('/');
    }
    expect(safeNextPath(null, '/home')).toBe('/home');
  });
});

describe('time zone conversion', () => {
  it('interprets wall-clock input in the chosen zone, across DST changes', () => {
    // New York switches to daylight time on 2026-03-08; 09:00 local is 14:00Z before and 13:00Z after.
    expect(fromLocalInput('2026-03-07T09:00', 'America/New_York')).toBe('2026-03-07T14:00:00.000Z');
    expect(fromLocalInput('2026-03-09T09:00', 'America/New_York')).toBe('2026-03-09T13:00:00.000Z');
    expect(toLocalInput('2026-03-09T13:00:00.000Z', 'America/New_York')).toBe('2026-03-09T09:00');
    expect(fromLocalInput('', 'UTC')).toBeNull();
  });
  it('round-trips in the display zone', () => {
    setDisplayZone('Asia/Kolkata');
    expect(fromLocalInput(toLocalInput('2026-10-11T12:30:00.000Z'))).toBe('2026-10-11T12:30:00.000Z');
    setDisplayZone('Not/AZone');
  });
});

describe('formatPoints', () => {
  it('formats integers and decimals without trailing zeros', () => {
    expect(formatPoints(20, 25)).toBe('20 / 25');
    expect(formatPoints(18.5)).toBe('18.5');
    expect(formatPoints(null)).toBe('Not graded');
  });
});

describe('greetingName', () => {
  it('skips titles and handles odd input', () => {
    expect(greetingName('Prof. Priya Raman')).toBe('Priya');
    expect(greetingName('Dr Arjun Mehta')).toBe('Arjun');
    expect(greetingName('  Kavya   Nair ')).toBe('Kavya');
    expect(greetingName('Dr.')).toBe('Dr.');
    expect(greetingName('')).toBe('');
    expect(greetingName(undefined)).toBe('');
  });
});

describe('parseReminderHours', () => {
  it('converts hours to minutes, largest first, without duplicates', () => {
    expect(parseReminderHours('1, 24, 0.5, 24')).toEqual({ minutes: [1440, 60, 30] });
    expect(parseReminderHours('')).toEqual({ minutes: [] });
  });
  it('reports bad entries instead of silently dropping them', () => {
    expect(parseReminderHours('abc')).toEqual({ error: '"abc" is not a number of hours.' });
    expect(parseReminderHours('24, -5')).toMatchObject({ error: expect.stringContaining('"-5"') });
    expect(parseReminderHours('0')).toMatchObject({ error: expect.stringContaining('out of range') });
    expect(parseReminderHours('400')).toMatchObject({ error: expect.stringContaining('out of range') });
    expect(parseReminderHours('1,2,3,4,5,6')).toEqual({ error: 'Use at most 5 reminder times.' });
  });
});
