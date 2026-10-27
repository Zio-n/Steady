import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { AppShell } from './ui/AppShell';
import { ProtectedRoute } from './app/ProtectedRoute';
import { CompleteProfileRoute } from './app/CompleteProfileRoute';
import { LoadingSkeleton } from './ui/components/LoadingSkeleton';
import { RouteAnnouncement } from './app/RouteAnnouncement';

export const router = createBrowserRouter([{
  element: <><RouteAnnouncement /><Outlet /></>,
  HydrateFallback: () => <main className="main-content"><LoadingSkeleton label="Opening Steady" /></main>,
  children: [
  { path: '/sign-in', lazy: async () => ({ Component: (await import('./ui/pages/SignInPage')).SignInPage }) },
  { path: '/onboarding', lazy: async () => ({ Component: (await import('./ui/pages/OnboardingPage')).OnboardingPage }) },
  {
    element: <ProtectedRoute />,
    children: [{
      element: <CompleteProfileRoute />,
      children: [{
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, lazy: async () => ({ Component: (await import('./ui/pages/TodayPage')).TodayPage }) },
          { path: 'library', lazy: async () => ({ Component: (await import('./ui/pages/LibraryPage')).LibraryPage }) },
          { path: 'routine', lazy: async () => ({ Component: (await import('./ui/pages/RoutinePage')).RoutinePage }) },
          { path: 'profile', lazy: async () => ({ Component: (await import('./ui/pages/ProfilePage')).ProfilePage }) },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      }],
    }],
  },
  ],
}]);
