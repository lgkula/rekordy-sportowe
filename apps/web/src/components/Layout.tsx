import { AppShell, Burger, Group, NavLink, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { NavLink as RouterNavLink, Outlet } from 'react-router';
import { useCanEdit } from '../auth/auth';
import { pl } from '../i18n/pl';
import { visibleNavItems } from '../navigation';
import { ApiStatus } from './ApiStatus';
import { RoleMenu } from './RoleMenu';

export function Layout() {
  const [opened, { toggle, close }] = useDisclosure();
  const canEdit = useCanEdit();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label={pl.nav.toggle}
            />
            <Title order={4}>{pl.appName}</Title>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <ApiStatus />
            <RoleMenu />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {visibleNavItems(canEdit).map((item) => (
          <RouterNavLink key={item.path} to={item.path} onClick={close}>
            {({ isActive }) => <NavLink component="span" label={item.label} active={isActive} />}
          </RouterNavLink>
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
