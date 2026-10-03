import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/charts/styles.css';
import '@mantine/notifications/styles.css';
import { createTheme, MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dayjs from 'dayjs';
import 'dayjs/locale/pl';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { installUnauthorizedHandler } from './auth/auth';
import { router } from './router';

dayjs.locale('pl');

const theme = createTheme({
  primaryColor: 'green',
  // Darker shades keep white text on filled buttons readable.
  primaryShade: { light: 8, dark: 8 },
  defaultRadius: 'md',
  colors: {
    // Mantine's dark greys with a slight green tint.
    dark: [
      '#c8d0ca',
      '#b2bcb5',
      '#7e8a82',
      '#647069',
      '#3e4943',
      '#36403a',
      '#29322d',
      '#202823',
      '#1b221e',
      '#121814',
    ],
  },
});
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});
installUnauthorizedHandler(queryClient);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <DatesProvider settings={{ locale: 'pl', firstDayOfWeek: 1 }}>
        <Notifications position="top-right" />
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
);
