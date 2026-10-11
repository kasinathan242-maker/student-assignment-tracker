import type { Response } from 'express';

/** Byte-order mark so spreadsheet apps detect UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/** CSV helpers. Output cells are escaped and protected against spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  if (value == null) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  // Cells starting with = + - @ (or tab/CR) are executed as formulas by spreadsheet apps.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(`${BOM}${csv}`);
}
