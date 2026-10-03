import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  PasswordInput,
  Stack,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconEye, IconLogout, IconPencil } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { authErrorMessage, useLogout, useMe, useSwitchRole, type Me } from '../auth/auth';
import { pl } from '../i18n/pl';

const ICON = 16;

/** Header badge with the current role; its menu switches roles, the cookie lifetime and logs out. */
export function RoleMenu() {
  const me = useMe().data;
  const switchRole = useSwitchRole();
  const logout = useLogout();
  const navigate = useNavigate();
  const [modalOpened, modal] = useDisclosure(false);

  if (!me) return null;
  const isEditor = me.role === 'editor';
  const onError = () => notifications.show({ color: 'red', message: pl.auth.menu.failed });

  const toEditor = () => {
    // Already unlocked in this session: no password needed (the server checks it too).
    if (me.editorUnlocked) switchRole.mutate({ targetRole: 'editor' }, { onError });
    else modal.open();
  };

  return (
    <>
      <Menu position="bottom-end" withinPortal closeOnItemClick={false}>
        <Menu.Target>
          <UnstyledButton aria-label={pl.auth.menu.label}>
            <Badge
              variant={isEditor ? 'filled' : 'light'}
              color={isEditor ? 'orange' : 'green'}
              rightSection="▾"
              style={{ cursor: 'pointer' }}
            >
              {pl.auth.roles[me.role]}
            </Badge>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          {isEditor ? (
            <Menu.Item
              leftSection={<IconEye size={ICON} />}
              closeMenuOnClick
              onClick={() => switchRole.mutate({ targetRole: 'viewer' }, { onError })}
            >
              {pl.auth.menu.switchToViewer}
            </Menu.Item>
          ) : (
            <Menu.Item leftSection={<IconPencil size={ICON} />} closeMenuOnClick onClick={toEditor}>
              {pl.auth.menu.switchToEditor}
            </Menu.Item>
          )}
          <RememberItem me={me} />
          <Menu.Divider />
          <Menu.Item
            color="red"
            leftSection={<IconLogout size={ICON} />}
            closeMenuOnClick
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
      <SwitchToEditorModal
        key={String(modalOpened)}
        opened={modalOpened}
        remember={me.remember}
        onClose={modal.close}
      />
    </>
  );
}

/** Toggles "remember in this browser" for the current session, keeping the role. */
function RememberItem({ me }: { me: Me }) {
  const switchRole = useSwitchRole();
  return (
    <Menu.Item
      leftSection={
        // Visual only: the menu item itself is the control.
        <span aria-hidden style={{ display: 'flex' }}>
          <Checkbox size="xs" checked={me.remember} readOnly tabIndex={-1} />
        </span>
      }
      disabled={switchRole.isPending}
      onClick={() =>
        switchRole.mutate(
          { targetRole: me.role, remember: !me.remember },
          { onError: () => notifications.show({ color: 'red', message: pl.auth.menu.failed }) },
        )
      }
    >
      {pl.auth.menu.remember}
    </Menu.Item>
  );
}

function SwitchToEditorModal({
  opened,
  remember: initialRemember,
  onClose,
}: {
  opened: boolean;
  remember: boolean;
  onClose: () => void;
}) {
  const switchRole = useSwitchRole();
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(initialRemember);
  const m = pl.auth.switchModal;

  const close = () => {
    setPassword('');
    switchRole.reset();
    onClose();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (password === '') return;
    switchRole.mutate(
      { targetRole: 'editor', password, remember },
      { onSuccess: close, onError: () => setPassword('') },
    );
  };

  return (
    <Modal opened={opened} onClose={close} title={m.title} centered>
      <form onSubmit={onSubmit} noValidate>
        <Stack>
          {switchRole.isError && <Alert color="red">{authErrorMessage(switchRole.error)}</Alert>}
          <PasswordInput
            label={m.password}
            description={m.passwordHint}
            autoComplete="current-password"
            data-autofocus
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          <Checkbox
            label={m.remember}
            checked={remember}
            onChange={(event) => setRemember(event.currentTarget.checked)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {m.cancel}
            </Button>
            <Button type="submit" loading={switchRole.isPending} disabled={password === ''}>
              {m.submit}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
