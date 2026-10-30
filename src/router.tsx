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
  { path: '/explore', lazy: async () => ({ Component: (await import('./ui/pages/ExplorePage')).ExplorePage }) },
  { path: '/onboarding', lazy: async () => ({ Component: (await import('./ui/pages/CalendarSetupPage')).CalendarSetupPage }) },
  {
    element: <ProtectedRoute />,
    children: [{
      element: <CompleteProfileRoute />,
      children: [{
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, lazy: async () => ({ Component: (await import('./ui/pages/CalendarPage')).CalendarPage }) },
          { path: 'calendar', element: <Navigate to="/" replace /> },
          { path: 'library', lazy: async () => ({ Component: (await import('./ui/pages/LibraryPage')).LibraryPage }) },
          { path: 'build', lazy: async () => ({ Component: (await import('./ui/pages/MealBuilderPage')).MealBuilderPage }) },
          { path: 'routine', element: <Navigate to="/" replace /> },
          { path: 'profile', element: <Navigate to="/settings" replace /> },
          { path: 'settings', lazy: async () => ({ Component: (await import('./ui/pages/ProfilePage')).ProfilePage }) },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      }],
    }],
  },
  ],
}]);
