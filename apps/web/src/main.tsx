import './styles.css';
import { IconContext } from '@phosphor-icons/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { router } from './app/router';
import { createQueryClient } from './lib/queryClient';

const queryClient = createQueryClient();

/** One stroke weight for every icon; "regular" stays crisp at the 16px size most UI icons use. */
const ICON_DEFAULTS = { weight: 'regular', mirrored: false } as const;

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <IconContext.Provider value={ICON_DEFAULTS}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster
          position="bottom-right"
          closeButton
          toastOptions={{ className: 'app-toast', classNames: { title: 'font-medium' } }}
        />
      </QueryClientProvider>
    </IconContext.Provider>
  </StrictMode>,
);
