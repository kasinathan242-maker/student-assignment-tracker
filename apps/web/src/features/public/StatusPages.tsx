import { isRouteErrorResponse, Link } from 'react-router';
import { ButtonLink } from '../../components/ui/button';

function StatusLayout({
  code,
  title,
  message,
  children,
}: {
  code: string;
  title: string;
  message: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[60dvh] animate-enter flex-col items-start justify-center px-4 py-16 sm:mx-auto sm:max-w-xl">
      {/* Used inside the app shell (the code is decorative; the heading carries the meaning). */}
      <p
        aria-hidden
        className="bg-gradient-to-b from-accent to-accent/25 bg-clip-text text-[6.5rem] leading-none font-semibold tracking-[-0.06em] text-transparent sm:text-[8rem]"
      >
        {code}
      </p>
      <h1 className="mt-6 text-[1.75rem] leading-tight font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-[48ch] text-[0.9375rem] text-fg-muted">{message}</p>
      <div className="mt-8 flex gap-2">
        {children ?? (
          <ButtonLink to="/" variant="primary">
            Go to your home page
          </ButtonLink>
        )}
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <StatusLayout
      code="404"
      title="Page not found"
      message="This page does not exist, or you do not have access to it."
    />
  );
}

export function Forbidden() {
  return (
    <StatusLayout
      code="403"
      title="You do not have access"
      message="Your role in this organization does not include this page. Ask an administrator if you need access."
    />
  );
}

export function ErrorPage({ error }: { error: unknown }) {
  const isChunkError =
    error instanceof Error && /dynamically imported module|Loading chunk/i.test(error.message);
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  return (
    <StatusLayout
      code="Error"
      title={isChunkError ? 'A new version is available' : 'Something went wrong'}
      message={
        isChunkError
          ? 'The app was updated while you were using it. Reload to continue.'
          : 'An unexpected error occurred while showing this page. Your saved work is not affected.'
      }
    >
      <button
        type="button"
        className="h-10 rounded-full bg-accent px-5 text-sm font-medium text-accent-fg transition-[background-color,transform] duration-200 hover:bg-accent-hover active:scale-[0.97]"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
      <Link
        to="/"
        className="inline-flex h-10 items-center rounded-full px-5 text-sm font-medium shadow-[inset_0_0_0_1px_var(--border-strong)] transition-colors duration-200 hover:bg-surface-2"
      >
        Home
      </Link>
    </StatusLayout>
  );
}
