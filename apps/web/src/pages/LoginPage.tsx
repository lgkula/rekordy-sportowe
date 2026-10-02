import { Alert, Button, Center, Checkbox, Paper, PasswordInput, Stack, Title } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { authErrorMessage, safeNextPath, useLogin, useMe } from '../auth/auth';
import { pl } from '../i18n/pl';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const navigate = useNavigate();
  const me = useMe();
  const login = useLogin();
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [missingPassword, setMissingPassword] = useState(false);

  if (me.data) return <Navigate to={next} replace />;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (password === '') {
      setMissingPassword(true);
      return;
    }
    login.mutate(
      { password, remember },
      {
        onSuccess: () => void navigate(next, { replace: true }),
        onError: () => setPassword(''),
      },
    );
  };

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" radius="md" w="100%" maw={380}>
        <form onSubmit={onSubmit} noValidate>
          <Stack>
            <Title order={2} ta="center">
              {pl.appName}
            </Title>
            <Title order={4} c="dimmed" ta="center" fw={500}>
              {pl.auth.login.title}
            </Title>
            {login.isError && <Alert color="red">{authErrorMessage(login.error)}</Alert>}
            <PasswordInput
              label={pl.auth.login.password}
              autoComplete="current-password"
              autoFocus
              value={password}
              error={missingPassword ? pl.auth.login.passwordRequired : undefined}
              onChange={(event) => {
                setPassword(event.currentTarget.value);
                setMissingPassword(false);
              }}
            />
            <Checkbox
              label={pl.auth.login.remember}
              checked={remember}
              onChange={(event) => setRemember(event.currentTarget.checked)}
            />
            <Button type="submit" loading={login.isPending} fullWidth>
              {pl.auth.login.submit}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
