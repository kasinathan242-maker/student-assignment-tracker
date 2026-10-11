import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, ErrorState, SkeletonRows } from '../../components/ui/feedback';
import { get } from '../../lib/api';

interface CapturedEmail {
  id: string;
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

/** Development-only viewer for emails captured by the "file"/"memory" providers (route not built in production). */
export function DevMailbox() {
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['dev-mail'],
    queryFn: () => get<CapturedEmail[]>('/dev/mail'),
    refetchInterval: 5000,
  });
  const message = q.data?.find((m) => m.id === selected) ?? q.data?.[0];
  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-2 text-xl font-semibold">Development mailbox</h1>
      <Alert tone="warning" className="mb-4">
        Only available in development. Production uses real email delivery.
      </Alert>
      {q.isPending && <SkeletonRows />}
      {q.error && (
        <ErrorState error={q.error} title="Mailbox unavailable (set DEV_MAILBOX_ENABLED=true for the API)" />
      )}
      {q.data && (
        <div className="grid gap-4 md:grid-cols-[22rem_1fr]">
          <ul className="max-h-[75vh] divide-y divide-border overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface">
            {q.data.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setSelected(m.id)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-surface-2"
                  aria-current={message?.id === m.id}
                >
                  <span className="block font-medium">{m.subject}</span>
                  <span className="block text-xs text-fg-muted">
                    {m.to} · {new Date(m.sentAt).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {message && (
            <article className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
              <h2 className="font-semibold">{message.subject}</h2>
              <p className="mb-3 text-sm text-fg-muted">To {message.to}</p>
              <pre className="font-sans text-sm whitespace-pre-wrap">
                {message.text.split(/(https?:\/\/\S+)/).map((part, i) =>
                  /^https?:\/\//.test(part) ? (
                    <a key={i} href={part} className="text-accent underline">
                      {part}
                    </a>
                  ) : (
                    part
                  ),
                )}
              </pre>
            </article>
          )}
        </div>
      )}
    </div>
  );
}
