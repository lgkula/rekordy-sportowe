import {
  ActionIcon,
  AppShell,
  Burger,
  em,
  Group,
  Stack,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure, useLocalStorage, useMediaQuery } from '@mantine/hooks';
import {
  IconBolt,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from '@tabler/icons-react';
import { NavLink as RouterNavLink, Outlet } from 'react-router';
import { useCanEdit } from '../auth/auth';
import { pl } from '../i18n/pl';
import { visibleNavItems, type NavItem } from '../navigation';
import { ApiStatus } from './ApiStatus';
import classes from './Layout.module.css';
import { RoleMenu } from './RoleMenu';

const NAV_WIDTH = 230;
/** Collapsed navbar on a desktop: icons only. */
const RAIL_WIDTH = 66;

function NavButton({ item, rail, onClick }: { item: NavItem; rail: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <Tooltip label={item.label} position="right" withArrow disabled={!rail}>
      {/* React Router sets aria-current="page" on the active link; the CSS styles it. */}
      <UnstyledButton
        component={RouterNavLink}
        to={item.path}
        className={classes.link}
        aria-label={rail ? item.label : undefined}
        onClick={onClick}
      >
        <span className={classes.icon}>
          <Icon size={20} stroke={1.7} />
        </span>
        {!rail && <span className={classes.label}>{item.label}</span>}
      </UnstyledButton>
    </Tooltip>
  );
}

export function Layout() {
  const [mobileOpened, mobile] = useDisclosure();
  // A per-browser convenience; Mantine's storage access falls back quietly when blocked.
  const [collapsed, setCollapsed] = useLocalStorage({
    key: 'rs.nav.collapsed',
    defaultValue: false,
    getInitialValueInEffect: false,
  });
  // On a phone the navbar is a full-width drawer, always with labels.
  const isMobile = useMediaQuery(`(max-width: ${em(767)})`);
  const rail = collapsed && !isMobile;
  const canEdit = useCanEdit();
  const ToggleIcon = collapsed ? IconLayoutSidebarLeftExpand : IconLayoutSidebarLeftCollapse;
  const toggleLabel = collapsed ? pl.nav.expand : pl.nav.collapse;

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: rail ? RAIL_WIDTH : NAV_WIDTH,
        breakpoint: 'sm',
        collapsed: { mobile: !mobileOpened },
      }}
      padding="md"
    >
      <AppShell.Header className={classes.header}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger
              opened={mobileOpened}
              onClick={mobile.toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label={pl.nav.toggle}
            />
            <Tooltip label={toggleLabel} withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                visibleFrom="sm"
                aria-label={toggleLabel}
                onClick={() => setCollapsed((value) => !value)}
              >
                <ToggleIcon size={22} stroke={1.6} />
              </ActionIcon>
            </Tooltip>
            <ThemeIcon
              variant="gradient"
              gradient={{ from: 'green.7', to: 'teal.6', deg: 135 }}
              size="md"
              radius="md"
              visibleFrom="sm"
            >
              <IconBolt size={18} />
            </ThemeIcon>
            <Title order={4} style={{ whiteSpace: 'nowrap' }}>
              {pl.appName}
            </Title>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <ApiStatus />
            <RoleMenu />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm" className={`${classes.navbar} ${rail ? classes.rail : ''}`}>
        <Stack gap={6}>
          {visibleNavItems(canEdit).map((item) => (
            <NavButton key={item.path} item={item} rail={rail} onClick={mobile.close} />
          ))}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
