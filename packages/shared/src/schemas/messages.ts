import { z } from 'zod';

const plural = (n: number | bigint, one: string, many: string) => `${n} ${Number(n) === 1 ? one : many}`;

/**
 * Plain-language validation messages, shared by the API and the web app. Zod's defaults read like
 * "Too big: expected number to be <=20160", which users see verbatim in form errors and toasts.
 * Messages set explicitly on a schema still take precedence.
 */
z.config({
  customError: (issue) => {
    switch (issue.code) {
      case 'invalid_type':
        if (issue.input === undefined || issue.input === null) return 'Required';
        if (issue.expected === 'number') return 'Enter a number';
        return undefined;
      case 'too_small': {
        const min = issue.minimum;
        if (issue.origin === 'string') {
          return Number(min) <= 1 ? 'Required' : `Use at least ${plural(min, 'character', 'characters')}`;
        }
        if (issue.origin === 'array' || issue.origin === 'set') return `Add at least ${min}`;
        if (issue.origin === 'number' || issue.origin === 'bigint') {
          return issue.inclusive ? `Must be at least ${min}` : `Must be more than ${min}`;
        }
        return undefined;
      }
      case 'too_big': {
        const max = issue.maximum;
        if (issue.origin === 'string') return `Use at most ${plural(max, 'character', 'characters')}`;
        if (issue.origin === 'array' || issue.origin === 'set') return `Use at most ${max}`;
        if (issue.origin === 'number' || issue.origin === 'bigint') {
          return issue.inclusive ? `Must be at most ${max}` : `Must be less than ${max}`;
        }
        return undefined;
      }
      case 'not_multiple_of':
        return `Must be a multiple of ${issue.divisor}`;
      default:
        return undefined;
    }
  },
});
