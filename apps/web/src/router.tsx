import { Center, Loader } from '@mantine/core';
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { EditorOnly, RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { defaultPath } from './navigation';
import { ActivitiesPage } from './pages/ActivitiesPage';
import { ActivityFormPage } from './pages/ActivityFormPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RecordsPage } from './pages/RecordsPage';

// Pages with charts, drag and drop and the FIT import load on demand, keeping the main bundle
// small.
const ActivityDetailPage = lazy(() =>
  import('./pages/ActivityDetailPage').then((m) => ({ default: m.ActivityDetailPage })),
);
const RacesPage = lazy(() => import('./pages/RacesPage').then((m) => ({ default: m.RacesPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const ImportPage = lazy(() =>
  import('./pages/ImportPage').then((m) => ({ default: m.ImportPage })),
);

function Lazy({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <Center py="xl">
          <Loader />
        </Center>
      }
    >
      {children}
    </Suspense>
  );
}

export const router = createBrowserRouter([
  { path: 'login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to={defaultPath} replace /> },
      { path: 'records', element: <RecordsPage /> },
      {
        path: 'races',
        element: (
          <Lazy>
            <RacesPage />
          </Lazy>
        ),
      },
      { path: 'activities', element: <ActivitiesPage /> },
      {
        path: 'activities/new',
        element: (
          <EditorOnly>
            <ActivityFormPage />
          </EditorOnly>
        ),
      },
      {
        path: 'activities/:id',
        element: (
          <Lazy>
            <ActivityDetailPage />
          </Lazy>
        ),
      },
      {
        path: 'activities/:id/edit',
        element: (
          <EditorOnly>
            <ActivityFormPage />
          </EditorOnly>
        ),
      },
      {
        path: 'import',
        element: (
          <EditorOnly>
            <Lazy>
              <ImportPage />
            </Lazy>
          </EditorOnly>
        ),
      },
      {
        path: 'admin',
        element: (
          <EditorOnly>
            <Lazy>
              <AdminPage />
            </Lazy>
          </EditorOnly>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
