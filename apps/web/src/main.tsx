import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './index.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { Toaster } from 'sonner';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { envStatus } from './lib/supabase';
import { ThemeProvider, useTheme } from './lib/theme';
import { ConfigMissingPage } from './pages/config-missing-page';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} position="bottom-right" richColors closeButton />;
}

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró #root');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      {envStatus.ok ? (
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrowserRouter basename={basename}>
              <App />
            </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      ) : (
        <ConfigMissingPage missing={envStatus.missing} />
      )}
      <ThemedToaster />
    </ThemeProvider>
  </StrictMode>,
);
