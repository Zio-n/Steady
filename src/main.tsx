import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { AppErrorBoundary } from './ui/components/AppErrorBoundary';
import { AuthProvider } from './app/AuthProvider';
import { ConnectivityBanner } from './app/ConnectivityBanner';
import { PwaUpdatePrompt } from './app/PwaUpdatePrompt';
import { createAppQueryClient } from './app/queryClient';
import '@fontsource-variable/manrope';
import './styles.css';

const queryClient = createAppQueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider><ConnectivityBanner /><PwaUpdatePrompt /><RouterProvider router={router} /></AuthProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
