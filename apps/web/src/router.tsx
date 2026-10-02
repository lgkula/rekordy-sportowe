import { createBrowserRouter, Navigate } from 'react-router';
import { EditorOnly, RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { pl } from './i18n/pl';
import { defaultPath } from './navigation';
import { ActivitiesPage } from './pages/ActivitiesPage';
import { ActivityFormPage } from './pages/ActivityFormPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

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
      { path: 'records', element: <PlaceholderPage title={pl.pages.records.title} /> },
      { path: 'races', element: <PlaceholderPage title={pl.pages.races.title} /> },
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
            <PlaceholderPage title={pl.pages.import.title} />
          </EditorOnly>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
