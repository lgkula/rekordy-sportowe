import {
  Alert,
  Anchor,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Pagination,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  ACTIVITY_SORTS,
  DEFAULT_PAGE_SIZE,
  ENABLED_SPORTS,
  formatDistance,
  formatDuration,
  formatLocalDate,
  formatPace,
  type ActivityListItem,
  type ActivitySort,
  type SortDir,
  type Sport,
} from '@rekordy/core';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useActivities, useDeleteActivity, usePatchActivity } from '../api/activities';
import { useCanEdit } from '../auth/auth';
import { pl } from '../i18n/pl';
import { t } from '../i18n/template';

type ListState = { sport: Sport | 'all'; sort: ActivitySort; dir: SortDir; page: number };

function readState(params: URLSearchParams): ListState {
  const sport = params.get('sport');
  const sort = params.get('sort');
  const validSort = (ACTIVITY_SORTS as readonly string[]).includes(sort ?? '');
  const sortValue = validSort ? (sort as ActivitySort) : 'date';
  const dir = params.get('dir');
  const page = Number(params.get('page'));
  return {
    sport: ENABLED_SPORTS.includes(sport as Sport) ? (sport as Sport) : 'all',
    sort: sortValue,
    dir: dir === 'asc' || dir === 'desc' ? dir : defaultDir(sortValue),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Newest first for dates, A→Z / shortest first otherwise. */
function defaultDir(sort: ActivitySort): SortDir {
  return sort === 'date' ? 'desc' : 'asc';
}

function SortHeader({
  column,
  label,
  state,
  onSort,
}: {
  column: ActivitySort;
  label: string;
  state: ListState;
  onSort: (column: ActivitySort) => void;
}) {
  const active = state.sort === column;
  const arrow = active ? (state.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <Table.Th aria-sort={active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <UnstyledButton
        onClick={() => onSort(column)}
        title={t(pl.activities.sortBy, { column: label })}
        fw={700}
        fz="sm"
      >
        {label}
        {arrow}
      </UnstyledButton>
    </Table.Th>
  );
}

export function ActivitiesPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const state = readState(params);
  const canEdit = useCanEdit();
  const [toDelete, setToDelete] = useState<ActivityListItem | null>(null);

  const query = useActivities({
    sport: state.sport === 'all' ? undefined : state.sport,
    sort: state.sort,
    dir: state.dir,
    page: state.page,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const patch = usePatchActivity();

  const update = (changes: Partial<ListState>) => {
    const next = { ...state, ...changes };
    const search = new URLSearchParams();
    if (next.sport !== 'all') search.set('sport', next.sport);
    if (next.sort !== 'date') search.set('sort', next.sort);
    if (next.dir !== defaultDir(next.sort)) search.set('dir', next.dir);
    if (next.page > 1) search.set('page', String(next.page));
    setParams(search);
  };

  const onSort = (column: ActivitySort) =>
    update(
      column === state.sort
        ? { dir: state.dir === 'asc' ? 'desc' : 'asc', page: 1 }
        : { sort: column, dir: defaultDir(column), page: 1 },
    );

  const toggleHidden = (activity: ActivityListItem) =>
    patch.mutate(
      { id: activity.id, patch: { isHidden: !activity.isHidden } },
      {
        onError: () => notifications.show({ color: 'red', message: pl.activities.actionFailed }),
      },
    );

  const listUrl = location.pathname + location.search;
  const newUrl = state.sport === 'all' ? '/activities/new' : `/activities/new?sport=${state.sport}`;
  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <Center py="xl">
        <Loader />
      </Center>
    );
  } else if (query.isError) {
    body = <Alert color="red">{pl.activities.loadFailed}</Alert>;
  } else if (data && data.items.length === 0) {
    body = <Text c="dimmed">{pl.activities.empty}</Text>;
  } else if (data) {
    const c = pl.activities.columns;
    body = (
      <Table.ScrollContainer minWidth={canEdit ? 900 : 760}>
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <SortHeader column="name" label={c.name} state={state} onSort={onSort} />
              <SortHeader column="date" label={c.date} state={state} onSort={onSort} />
              <SortHeader column="distance" label={c.distance} state={state} onSort={onSort} />
              <Table.Th>{c.duration}</Table.Th>
              <Table.Th>{c.pace}</Table.Th>
              <Table.Th>{c.sport}</Table.Th>
              <Table.Th ta="center">{c.race}</Table.Th>
              <Table.Th ta="center">{c.hidden}</Table.Th>
              {canEdit && <Table.Th>{c.actions}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.items.map((activity) => (
              <Table.Tr
                key={activity.id}
                style={activity.isHidden ? { opacity: 0.5 } : undefined}
                title={activity.isHidden ? pl.activities.hiddenHint : undefined}
              >
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Anchor
                      component={Link}
                      to={`/activities/${activity.id}`}
                      state={{ from: listUrl }}
                      size="sm"
                    >
                      {activity.name}
                    </Anchor>
                    {activity.activityUrl && (
                      <Anchor
                        href={activity.activityUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        size="sm"
                        title={pl.activities.openLink}
                        aria-label={pl.activities.openLink}
                      >
                        ↗
                      </Anchor>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>{formatLocalDate(activity.localDate)}</Table.Td>
                <Table.Td>{formatDistance(activity.distanceM)}</Table.Td>
                <Table.Td>
                  {activity.durationS === null ? '—' : formatDuration(activity.durationS)}
                </Table.Td>
                <Table.Td>
                  {activity.paceSPerKm === null
                    ? '—'
                    : formatPace(activity.paceSPerKm, { unit: true })}
                </Table.Td>
                <Table.Td>{pl.sports[activity.sport]}</Table.Td>
                <Table.Td ta="center">{activity.isRace ? '✓' : ''}</Table.Td>
                <Table.Td>
                  <Center>
                    {canEdit ? (
                      <Switch
                        size="sm"
                        checked={activity.isHidden}
                        onChange={() => toggleHidden(activity)}
                        aria-label={activity.isHidden ? pl.activities.show : pl.activities.hide}
                        title={activity.isHidden ? pl.activities.show : pl.activities.hide}
                      />
                    ) : activity.isHidden ? (
                      '✓'
                    ) : (
                      ''
                    )}
                  </Center>
                </Table.Td>
                {canEdit && (
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Button
                        component={Link}
                        to={`/activities/${activity.id}/edit`}
                        state={{ from: listUrl }}
                        variant="subtle"
                        size="compact-sm"
                      >
                        {pl.activities.edit}
                      </Button>
                      <Button
                        variant="subtle"
                        color="red"
                        size="compact-sm"
                        onClick={() => setToDelete(activity)}
                      >
                        {pl.activities.delete}
                      </Button>
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    );
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{pl.pages.activities.title}</Title>
        {canEdit && (
          <Button component={Link} to={newUrl} state={{ from: listUrl }}>
            {pl.activities.add}
          </Button>
        )}
      </Group>

      <Tabs
        value={state.sport}
        onChange={(value) => update({ sport: (value ?? 'all') as ListState['sport'], page: 1 })}
      >
        <Tabs.List>
          <Tabs.Tab value="all">{pl.sports.all}</Tabs.Tab>
          {ENABLED_SPORTS.map((sport) => (
            <Tabs.Tab key={sport} value={sport}>
              {pl.sports[sport]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      {body}

      {data && data.total > 0 && (
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {t(pl.activities.total, { count: data.total })}
          </Text>
          {totalPages > 1 && (
            <Pagination
              total={totalPages}
              value={state.page}
              onChange={(page) => update({ page })}
              size="sm"
            />
          )}
        </Group>
      )}

      <DeleteActivityModal activity={toDelete} onClose={() => setToDelete(null)} />
    </Stack>
  );
}

function DeleteActivityModal({
  activity,
  onClose,
}: {
  activity: ActivityListItem | null;
  onClose: () => void;
}) {
  const remove = useDeleteActivity();
  const m = pl.activities.deleteModal;

  const confirm = () => {
    if (!activity) return;
    remove.mutate(activity.id, {
      onSuccess: () => {
        notifications.show({ color: 'green', message: pl.activities.deleted });
        onClose();
      },
      onError: () => notifications.show({ color: 'red', message: pl.activities.actionFailed }),
    });
  };

  return (
    <Modal opened={activity !== null} onClose={onClose} title={m.title} centered>
      <Stack>
        <Text size="sm">
          {activity &&
            t(m.body, { name: activity.name, date: formatLocalDate(activity.localDate) })}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {m.cancel}
          </Button>
          <Button color="red" onClick={confirm} loading={remove.isPending} data-autofocus>
            {m.confirm}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
