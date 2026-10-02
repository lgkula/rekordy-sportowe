import { createBrowserRouter, Navigate } from 'react-router';
import { Layout } from './components/Layout';
import { pl } from './i18n/pl';
import { defaultPath } from './navigation';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to={defaultPath} replace /> },
      { path: 'records', element: <PlaceholderPage title={pl.pages.records.title} /> },
      { path: 'races', element: <PlaceholderPage title={pl.pages.races.title} /> },
      { path: 'activities', element: <PlaceholderPage title={pl.pages.activities.title} /> },
      { path: 'import', element: <PlaceholderPage title={pl.pages.import.title} /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
