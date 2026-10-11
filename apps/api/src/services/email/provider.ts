import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  category: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
  healthCheck(): Promise<boolean>;
}

/** Production delivery through any SMTP relay or transactional provider's SMTP endpoint. */
class SmtpProvider implements EmailProvider {
  readonly name = 'smtp';
  private transporter: Transporter;
  constructor() {
    const config = env();
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT ?? (config.SMTP_SECURE ? 465 : 587),
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: env().EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: { 'X-SAT-Category': message.category },
    });
  }
  async healthCheck(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}

export interface CapturedEmail extends EmailMessage {
  id: string;
  sentAt: string;
}

/** Development: writes each message as JSON into DEV_MAILBOX_DIR (viewable in the dev mailbox page). */
class FileProvider implements EmailProvider {
  readonly name = 'file';
  constructor(private readonly dir = path.resolve(env().DEV_MAILBOX_DIR)) {}
  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: CapturedEmail = { ...message, id, sentAt: new Date().toISOString() };
    await writeFile(path.join(this.dir, `${id}.json`), JSON.stringify(record, null, 2), 'utf8');
  }
  async list(): Promise<CapturedEmail[]> {
    try {
      const files = (await readdir(this.dir))
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 200);
      return Promise.all(
        files.map(async (f) => JSON.parse(await readFile(path.join(this.dir, f), 'utf8')) as CapturedEmail),
      );
    } catch {
      return [];
    }
  }
  async healthCheck(): Promise<boolean> {
    return true;
  }
}

/** Tests: keeps messages in memory. */
export class MemoryProvider implements EmailProvider {
  readonly name = 'memory';
  readonly sent: CapturedEmail[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.unshift({ ...message, id: String(this.sent.length + 1), sentAt: new Date().toISOString() });
  }
  async list(): Promise<CapturedEmail[]> {
    return this.sent;
  }
  async healthCheck(): Promise<boolean> {
    return true;
  }
}

let provider: EmailProvider | null = null;

export function emailProvider(): EmailProvider {
  if (provider) return provider;
  const kind = env().EMAIL_PROVIDER;
  provider =
    kind === 'smtp' ? new SmtpProvider() : kind === 'memory' ? new MemoryProvider() : new FileProvider();
  return provider;
}

export function setEmailProvider(next: EmailProvider | null): void {
  provider = next;
}

export async function capturedEmails(): Promise<CapturedEmail[]> {
  const p = emailProvider();
  if (p instanceof FileProvider || p instanceof MemoryProvider) return p.list();
  return [];
}
