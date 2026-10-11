import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Retry only transient failures (network / 5xx), never 4xx answers.
        retry: (count, error) =>
          error instanceof ApiError && (error.isNetwork || error.status >= 500) && count < 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 250,
      },
      mutations: { retry: false },
    },
  });
}
