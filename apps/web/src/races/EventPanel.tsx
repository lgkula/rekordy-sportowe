import {
  Alert,
  Anchor,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  formatDistance,
  formatDuration,
  formatLocalDate,
  formatPace,
  SPORT_CONFIG,
  type EventEdition,
  type EventListItem,
} from '@rekordy/core';
import { Fragment, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useActivity } from '../api/activities';
import { useEvent } from '../api/events';
import { SplitsView } from '../components/SplitsView';
import { pl } from '../i18n/pl';
import { editionOf } from './races';

const r = pl.races;

export type PanelAction =
  | { type: 'editEvent'; event: EventListItem }
  | { type: 'merge'; event: EventListItem }
  | { type: 'delete'; event: EventListItem }
  | { type: 'createFrom'; activityId: number; name: string }
  | { type: 'edition'; activityId: number };

/**
 * Content of an expanded event: the editor's actions and the editions, newest first. A race
 * without an event is its own single edition.
 */
export function EventPanel({
  item,
  canEdit,
  onAction,
}: {
  item: EventListItem;
  canEdit: boolean;
  onAction: (action: PanelAction) => void;
}) {
  const event = useEvent(item.id);
  const activity = useActivity(item.id === null ? (item.activityId ?? undefined) : undefined);
  const query = item.id === null ? activity : event;
  const editions =
    item.id === null ? activity.data && [editionOf(activity.data)] : event.data?.editions;
  const a = r.actions;

  return (
    <Stack gap="sm">
      {canEdit && (
        <Group gap="xs">
          {item.id === null ? (
            <>
              <Button
                size="compact-sm"
                variant="light"
                onClick={() =>
                  onAction({ type: 'createFrom', activityId: item.activityId!, name: item.name })
                }
              >
                {a.create}
              </Button>
              <Button
                size="compact-sm"
                variant="default"
                onClick={() => onAction({ type: 'edition', activityId: item.activityId! })}
              >
                {a.assign}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="compact-sm"
                variant="light"
                onClick={() => onAction({ type: 'editEvent', event: item })}
              >
                {a.edit}
              </Button>
              <Button
                size="compact-sm"
                variant="default"
                onClick={() => onAction({ type: 'merge', event: item })}
              >
                {a.merge}
              </Button>
              <Button
                size="compact-sm"
                variant="subtle"
                color="red"
                onClick={() => onAction({ type: 'delete', event: item })}
              >
                {a.delete}
              </Button>
            </>
          )}
        </Group>
      )}
      {canEdit && item.id === null && (
        <Text size="sm" c="dimmed">
          {r.unassignedHint}
        </Text>
      )}
      {query.isPending ? (
        <Center py="sm">
          <Loader size="sm" />
        </Center>
      ) : query.isError || !editions ? (
        <Alert color="red">{r.loadFailed}</Alert>
      ) : editions.length === 0 ? (
        <Text size="sm" c="dimmed">
          {r.noEditions}
        </Text>
      ) : (
        <EditionsTable
          editions={editions}
          tracksElevation={SPORT_CONFIG[item.sport].tracksElevation}
          onEdit={canEdit ? (activityId) => onAction({ type: 'edition', activityId }) : undefined}
        />
      )}
    </Stack>
  );
}

function EditionsTable({
  editions,
  tracksElevation,
  onEdit,
}: {
  editions: readonly EventEdition[];
  tracksElevation: boolean;
  onEdit?: (activityId: number) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const c = r.editionColumns;
  const columnCount = 5 + (tracksElevation ? 1 : 0) + (onEdit ? 1 : 0);
  const toggle = (activityId: number) =>
    setExpanded((current) => (current === activityId ? null : activityId));

  return (
    // On a phone the date moves under the edition label, so the table fits without scrolling.
    <Table.ScrollContainer minWidth={280}>
      <Table verticalSpacing={6} fz="sm" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{c.label}</Table.Th>
            <Table.Th visibleFrom="sm">{c.date}</Table.Th>
            <Table.Th>{c.pace}</Table.Th>
            <Table.Th>{c.duration}</Table.Th>
            <Table.Th visibleFrom="sm">{c.distance}</Table.Th>
            {tracksElevation && <Table.Th visibleFrom="sm">{c.elevationGain}</Table.Th>}
            {onEdit && <Table.Th aria-label={c.actions} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {editions.map((edition) => {
            const open = expanded === edition.activityId;
            return (
              <Fragment key={edition.activityId}>
                <Table.Tr
                  style={{ cursor: 'pointer' }}
                  c={edition.isHidden ? 'dimmed' : undefined}
                  onClick={() => toggle(edition.activityId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggle(edition.activityId);
                    }
                  }}
                  tabIndex={0}
                  aria-expanded={open}
                  title={r.showDetails}
                >
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Text span fz="xs" c="dimmed" aria-hidden>
                        {open ? '▾' : '▸'}
                      </Text>
                      <Text span fz="sm" fw={500}>
                        {edition.editionLabel ?? '—'}
                      </Text>
                      {edition.isHidden && (
                        <Badge size="xs" color="gray" variant="light" title={r.hiddenHint}>
                          {r.hidden}
                        </Badge>
                      )}
                    </Group>
                    <Text hiddenFrom="sm" fz="xs" c="dimmed" pl={14}>
                      {formatLocalDate(edition.localDate)}
                    </Text>
                  </Table.Td>
                  <Table.Td visibleFrom="sm" style={{ whiteSpace: 'nowrap' }}>
                    {formatLocalDate(edition.localDate)}
                  </Table.Td>
                  <Table.Td fw={600} style={{ whiteSpace: 'nowrap' }}>
                    {edition.paceSPerKm === null
                      ? '—'
                      : formatPace(edition.paceSPerKm, { unit: true })}
                  </Table.Td>
                  <Table.Td>
                    {edition.durationS === null ? '—' : formatDuration(edition.durationS)}
                  </Table.Td>
                  <Table.Td visibleFrom="sm" style={{ whiteSpace: 'nowrap' }}>
                    {formatDistance(edition.distanceM)}
                  </Table.Td>
                  {tracksElevation && (
                    <Table.Td visibleFrom="sm">
                      {edition.elevationGainM === null ? '—' : `${edition.elevationGainM} m`}
                    </Table.Td>
                  )}
                  {onEdit && (
                    <Table.Td>
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit(edition.activityId);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        {r.actions.editEdition}
                      </Button>
                    </Table.Td>
                  )}
                </Table.Tr>
                {open && (
                  <Table.Tr>
                    <Table.Td colSpan={columnCount} bg="var(--mantine-color-default-hover)">
                      <EditionDetail activityId={edition.activityId} />
                    </Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

/** Per-km splits (table + bar chart) and notes of an edition (PLAN.md 4.3). */
function EditionDetail({ activityId }: { activityId: number }) {
  const query = useActivity(activityId);
  const location = useLocation();

  if (query.isPending) {
    return (
      <Center py="sm">
        <Loader size="sm" />
      </Center>
    );
  }
  if (query.isError) return <Alert color="red">{r.detailFailed}</Alert>;
  const activity = query.data;

  return (
    <Stack gap="sm" py="xs">
      <Group gap="md">
        <Anchor
          component={Link}
          to={`/activities/${activity.id}`}
          state={{ from: `${location.pathname}${location.search}` }}
          size="sm"
        >
          {r.openActivity}: {activity.name}
        </Anchor>
        {activity.activityUrl && (
          <Anchor href={activity.activityUrl} target="_blank" rel="noopener noreferrer" size="sm">
            {r.openLink} ↗
          </Anchor>
        )}
      </Group>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Stack gap={4}>
          <Title order={5}>{r.notes}</Title>
          {activity.notes ? (
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
              {activity.notes}
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              {r.noNotes}
            </Text>
          )}
        </Stack>
        <Stack gap={4}>
          <Title order={5}>{pl.splits.title}</Title>
          <SplitsView splits={activity.splits ?? []} />
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
