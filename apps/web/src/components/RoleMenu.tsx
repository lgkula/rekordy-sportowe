import {
  Alert,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  PasswordInput,
  Stack,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { authErrorMessage, useLogout, useMe, useSwitchRole } from '../auth/auth';
import { pl } from '../i18n/pl';

/** Header badge with the current role; its menu switches roles and logs out. */
export function RoleMenu() {
  const me = useMe().data;
  const switchRole = useSwitchRole();
  const logout = useLogout();
  const navigate = useNavigate();
  const [modalOpened, modal] = useDisclosure(false);

  if (!me) return null;
  const isEditor = me.role === 'editor';

  return (
    <>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <UnstyledButton aria-label={pl.auth.menu.label}>
            <Badge
              variant={isEditor ? 'filled' : 'light'}
              color={isEditor ? 'orange' : 'blue'}
              rightSection="▾"
              style={{ cursor: 'pointer' }}
            >
              {pl.auth.roles[me.role]}
            </Badge>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          {isEditor ? (
            <Menu.Item onClick={() => switchRole.mutate({ targetRole: 'viewer' })}>
              {pl.auth.menu.switchToViewer}
            </Menu.Item>
          ) : (
            <Menu.Item onClick={modal.open}>{pl.auth.menu.switchToEditor}</Menu.Item>
          )}
          <Menu.Divider />
          <Menu.Item
            color="red"
            onClick={() =>
              logout.mutate(undefined, {
                onSettled: () => void navigate('/login', { replace: true }),
              })
            }
          >
            {pl.auth.menu.logout}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <SwitchToEditorModal opened={modalOpened} onClose={modal.close} />
    </>
  );
}

function SwitchToEditorModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const switchRole = useSwitchRole();
  const [password, setPassword] = useState('');

  const close = () => {
    setPassword('');
    switchRole.reset();
    onClose();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (password === '') return;
    switchRole.mutate(
      { targetRole: 'editor', password },
      { onSuccess: close, onError: () => setPassword('') },
    );
  };

  return (
    <Modal opened={opened} onClose={close} title={pl.auth.switchModal.title} centered>
      <form onSubmit={onSubmit} noValidate>
        <Stack>
          {switchRole.isError && <Alert color="red">{authErrorMessage(switchRole.error)}</Alert>}
          <PasswordInput
            label={pl.auth.switchModal.password}
            autoComplete="current-password"
            data-autofocus
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {pl.auth.switchModal.cancel}
            </Button>
            <Button type="submit" loading={switchRole.isPending} disabled={password === ''}>
              {pl.auth.switchModal.submit}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
