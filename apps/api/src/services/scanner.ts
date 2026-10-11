import { connect, type Socket } from 'node:net';
import type { FileScanStatus } from '@sat/shared';
import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Malware scanning provider interface. "none" marks files as `skipped` — they are NOT treated as clean;
 * with REQUIRE_CLEAN_SCAN=true they cannot be downloaded until a scanner reports them clean.
 * "clamav" streams the bytes to clamd (INSTREAM protocol).
 */
export interface MalwareScanner {
  readonly name: string;
  scan(data: Buffer): Promise<Exclude<FileScanStatus, 'pending'>>;
  healthCheck(): Promise<boolean>;
}

class NoopScanner implements MalwareScanner {
  readonly name = 'none';
  async scan(): Promise<'skipped'> {
    return 'skipped';
  }
  async healthCheck(): Promise<boolean> {
    return true;
  }
}

export class ClamAvScanner implements MalwareScanner {
  readonly name = 'clamav';
  constructor(
    private readonly host = env().CLAMAV_HOST,
    private readonly port = env().CLAMAV_PORT,
  ) {}

  private command(write: (socket: Socket) => void, timeoutMs = 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error('clamd timeout')));
      socket.on('connect', () => write(socket));
      socket.on('data', (c: Buffer) => chunks.push(c));
      socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim()));
      socket.on('error', reject);
    });
  }

  async scan(data: Buffer): Promise<'clean' | 'infected' | 'error'> {
    try {
      const reply = await this.command((socket) => {
        socket.write('zINSTREAM\0');
        const chunkSize = 64 * 1024;
        for (let offset = 0; offset < data.length; offset += chunkSize) {
          const chunk = data.subarray(offset, offset + chunkSize);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length);
          socket.write(size);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
      if (reply.endsWith('OK')) return 'clean';
      if (reply.endsWith('FOUND')) return 'infected';
      logger().warn({ reply }, 'unexpected clamd reply');
      return 'error';
    } catch (err) {
      logger().warn({ err }, 'clamd scan failed');
      return 'error';
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      return (await this.command((s) => s.end('zPING\0'), 3_000)) === 'PONG';
    } catch {
      return false;
    }
  }
}

let instance: MalwareScanner | null = null;

export function scanner(): MalwareScanner {
  instance ??= env().MALWARE_SCANNER === 'clamav' ? new ClamAvScanner() : new NoopScanner();
  return instance;
}

export function setScanner(next: MalwareScanner | null): void {
  instance = next;
}
