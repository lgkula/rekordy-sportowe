import { Alert, Button, Center, Loader, Stack } from '@mantine/core';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { pl } from '../i18n/pl';
import { loginPath, useCanEdit, useMe } from './auth';

/** Route guard: renders the children only with a session, otherwise redirects to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isPending, isError, refetch } = useMe();
  const location = useLocation();

  if (isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (isError) {
    return (
      <Center h="100vh" p="md">
        <Stack align="center">
          <Alert color="red">{pl.auth.sessionCheckFailed}</Alert>
          <Button variant="light" onClick={() => void refetch()}>
            {pl.auth.retry}
          </Button>
        </Stack>
      </Center>
    );
  }
  if (!data) {
    return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  }
  return children;
}

/** Page body for editor-only sections; viewers get a notice instead. */
export function EditorOnly({ children }: { children: ReactNode }) {
  const canEdit = useCanEdit();
  return canEdit ? children : <Alert color="gray">{pl.editorOnly}</Alert>;
}
