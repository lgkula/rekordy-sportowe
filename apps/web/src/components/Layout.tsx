import { AppShell, Burger, Group, NavLink, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { NavLink as RouterNavLink, Outlet } from 'react-router';
import { pl } from '../i18n/pl';
import { navItems } from '../navigation';
import { ApiStatus } from './ApiStatus';

export function Layout() {
  const [opened, { toggle, close }] = useDisclosure();

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
          <ApiStatus />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {navItems.map((item) => (
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
