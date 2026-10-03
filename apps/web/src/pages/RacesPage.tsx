import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Accordion,
  ActionIcon,
  Alert,
  Box,
  Button,
  Center,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  ENABLED_SPORTS,
  formatPace,
  sortEventList,
  SPORT_CONFIG,
  type EventListItem,
  type EventOrdering,
  type Sport,
} from '@rekordy/core';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useEvents, useSaveEventOrder, useSaveEventOrdering } from '../api/events';
import { useCanEdit } from '../auth/auth';
import { pl } from '../i18n/pl';
import { plural } from '../i18n/template';
import { EventPanel, type PanelAction } from '../races/EventPanel';
import { DeleteEventModal, EditionModal, EventFormModal, MergeModal } from '../races/RaceModals';
import { bestEditionLabel, formatEventDistance, readSport, reorderIds } from '../races/races';

const r = pl.races;

type ModalState = PanelAction | { type: 'createEvent' } | null;

/** Width of the drag handle column, so the header lines up with the rows. */
const HANDLE_W = 28;

function columns(tracksElevation: boolean): string {
  return `minmax(0, 1fr) 90px 130px ${tracksElevation ? '110px ' : ''}64px`;
}

function editionsText(count: number): string {
  return `${count} ${plural(count, r.editionForms)}`;
}

/** One event's summary inside the accordion control. */
function EventSummary({
  item,
  tracksElevation,
}: {
  item: EventListItem;
  tracksElevation: boolean;
}) {
  const pace = item.bestPaceSPerKm === null ? '—' : formatPace(item.bestPaceSPerKm, { unit: true });
  const from = bestEditionLabel(item);
  const elevation = item.elevationGainM === null ? '—' : `${item.elevationGainM} m`;
  const name = (
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
      <Text fw={600} truncate>
        {item.name}
      </Text>
      {item.id === null && (
        <Text span size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          ({r.unassigned})
        </Text>
      )}
    </Group>
  );
  return (
    <>
      <Box
        visibleFrom="sm"
        style={{
          display: 'grid',
          gridTemplateColumns: columns(tracksElevation),
          alignItems: 'center',
          columnGap: 12,
        }}
      >
        {name}
        <Text size="sm">{formatEventDistance(item.distanceM)}</Text>
        <div>
          <Text size="sm" fw={600}>
            {pace}
          </Text>
          {from && (
            <Text size="xs" c="dimmed" truncate>
              {from}
            </Text>
          )}
        </div>
        {tracksElevation && <Text size="sm">{elevation}</Text>}
        <Text size="sm" ta="right">
          {item.editionCount}
        </Text>
      </Box>
      <Stack hiddenFrom="sm" gap={2}>
        {name}
        <Text size="sm" c="dimmed">
          {[
            formatEventDistance(item.distanceM),
            pace,
            ...(tracksElevation ? [elevation] : []),
            editionsText(item.editionCount),
          ].join(' · ')}
        </Text>
      </Stack>
    </>
  );
}

function EventItem({
  item,
  open,
  canEdit,
  sortable,
  tracksElevation,
  onAction,
}: {
  item: EventListItem;
  open: boolean;
  canEdit: boolean;
  /** Drag handle shown (editor, manual order); null: no handle column at all. */
  sortable: boolean | null;
  tracksElevation: boolean;
  onAction: (action: PanelAction) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    disabled: !sortable,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 2 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <Accordion.Item value={item.key}>
        <Group gap={0} wrap="nowrap" align="center">
          {sortable !== null && (
            <Box w={HANDLE_W} style={{ flexShrink: 0 }} pl={4}>
              {sortable && (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={r.dragHandle}
                  title={r.dragHandle}
                  style={{ cursor: 'grab', touchAction: 'none' }}
                  {...attributes}
                  {...listeners}
                >
                  ⠿
                </ActionIcon>
              )}
            </Box>
          )}
          <Accordion.Control style={{ minWidth: 0 }}>
            <EventSummary item={item} tracksElevation={tracksElevation} />
          </Accordion.Control>
        </Group>
        <Accordion.Panel>
          {open && <EventPanel item={item} canEdit={canEdit} onAction={onAction} />}
        </Accordion.Panel>
      </Accordion.Item>
    </div>
  );
}

/**
 * `/races`: races per sport (PLAN.md 4.3, 8). Editions of a race are grouped into an event
 * with its best pace; an event expands into its editions, an edition into its per-km splits
 * and notes. The editor orders events by hand (drag and drop) or by name.
 */
export function RacesPage() {
  const [params, setParams] = useSearchParams();
  const sport = readSport(params);
  const opened = params.get('event');
  const canEdit = useCanEdit();
  const query = useEvents(sport);
  const saveOrder = useSaveEventOrder();
  const saveOrdering = useSaveEventOrdering();
  /** A viewer may sort differently for themselves; only the editor saves the setting. */
  const [viewerOrdering, setViewerOrdering] = useState<Partial<Record<Sport, EventOrdering>>>({});
  const [modal, setModal] = useState<ModalState>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const setSearch = (next: { sport?: Sport; event?: string | null }) => {
    const nextSport = next.sport ?? sport;
    const nextEvent = next.event === undefined ? opened : next.event;
    const search: Record<string, string> = {};
    if (nextSport !== ENABLED_SPORTS[0]) search.sport = nextSport;
    if (nextEvent) search.event = nextEvent;
    setParams(search, { replace: true });
  };

  const data = query.data;
  const ordering: EventOrdering = data
    ? canEdit
      ? data.ordering
      : (viewerOrdering[sport] ?? data.ordering)
    : 'manual';
  const items = data ? sortEventList(data.events, ordering) : [];
  const manualDrag = canEdit && ordering === 'manual';
  const eventIds = items.flatMap((item) => (item.id === null ? [] : [item.id]));
  const tracksElevation = SPORT_CONFIG[sport].tracksElevation;

  const changeOrdering = (value: EventOrdering) => {
    if (!canEdit) {
      setViewerOrdering((current) => ({ ...current, [sport]: value }));
      return;
    }
    saveOrdering.mutate(
      { sport, ordering: value },
      { onError: () => notifications.show({ color: 'red', message: r.orderingSaveFailed }) },
    );
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const idOf = (key: unknown) => Number(String(key).slice(1));
    const ids = reorderIds(eventIds, idOf(active.id), idOf(over.id));
    saveOrder.mutate(
      { sport, ids },
      { onError: () => notifications.show({ color: 'red', message: r.orderingSaveFailed }) },
    );
  };

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <Center py="xl">
        <Loader />
      </Center>
    );
  } else if (query.isError) {
    body = <Alert color="red">{r.loadFailed}</Alert>;
  } else if (items.length === 0) {
    body = <Text c="dimmed">{r.empty}</Text>;
  } else {
    const c = r.columns;
    body = (
      <Stack gap={4}>
        <Box
          visibleFrom="sm"
          pr="md"
          // Handle column + chevron (15px) with its margins, as in the rows.
          pl={`calc(${manualDrag ? HANDLE_W : 0}px + 2 * var(--mantine-spacing-md) + 15px)`}
          style={{
            display: 'grid',
            gridTemplateColumns: columns(tracksElevation),
            columnGap: 12,
          }}
        >
          {[c.name, c.distance, c.bestPace, ...(tracksElevation ? [c.elevationGain] : [])].map(
            (label) => (
              <Text key={label} size="xs" fw={600} c="dimmed">
                {label}
              </Text>
            ),
          )}
          <Text size="xs" fw={600} c="dimmed" ta="right">
            {c.editions}
          </Text>
        </Box>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={items.filter((i) => i.id !== null).map((i) => i.key)}
            strategy={verticalListSortingStrategy}
          >
            <Accordion
              variant="separated"
              chevronPosition="left"
              value={opened}
              onChange={(value) => setSearch({ event: value })}
            >
              {items.map((item) => (
                <EventItem
                  key={item.key}
                  item={item}
                  open={opened === item.key}
                  canEdit={canEdit}
                  sortable={manualDrag ? item.id !== null : null}
                  tracksElevation={tracksElevation}
                  onAction={setModal}
                />
              ))}
            </Accordion>
          </SortableContext>
        </DndContext>
      </Stack>
    );
  }

  const close = () => setModal(null);
  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Title order={2}>{pl.pages.races.title}</Title>
        {canEdit && (
          <Button variant="light" onClick={() => setModal({ type: 'createEvent' })}>
            {r.add}
          </Button>
        )}
      </Group>
      <Tabs
        value={sport}
        onChange={(value) => value && setSearch({ sport: value as Sport, event: null })}
      >
        <Tabs.List>
          {ENABLED_SPORTS.map((s) => (
            <Tabs.Tab key={s} value={s}>
              {pl.sports[s]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      <Group gap="xs">
        <Text size="sm">{r.ordering}:</Text>
        <SegmentedControl
          size="xs"
          value={ordering}
          onChange={(value) => changeOrdering(value as EventOrdering)}
          data={[
            { value: 'manual', label: r.orderings.manual },
            { value: 'name', label: r.orderings.name },
          ]}
          disabled={!data}
        />
        {!canEdit && viewerOrdering[sport] !== undefined && (
          <Text size="xs" c="dimmed">
            {r.viewerOrderingHint}
          </Text>
        )}
      </Group>
      {body}

      {canEdit && modal?.type === 'createEvent' && (
        <EventFormModal
          sport={sport}
          onClose={close}
          onCreated={(id) => setSearch({ event: `e${id}` })}
        />
      )}
      {canEdit && modal?.type === 'createFrom' && (
        <EventFormModal
          sport={sport}
          fromActivity={{ id: modal.activityId, name: modal.name }}
          onClose={close}
          onCreated={(id) => setSearch({ event: `e${id}` })}
        />
      )}
      {canEdit && modal?.type === 'editEvent' && (
        <EventFormModal sport={sport} event={modal.event} onClose={close} />
      )}
      {canEdit && modal?.type === 'merge' && (
        <MergeModal
          event={modal.event}
          events={items}
          onClose={close}
          onMerged={(targetId) => setSearch({ event: `e${targetId}` })}
        />
      )}
      {canEdit && modal?.type === 'delete' && (
        <DeleteEventModal event={modal.event} onClose={close} />
      )}
      {canEdit && modal?.type === 'edition' && (
        <EditionModal activityId={modal.activityId} onClose={close} />
      )}
    </Stack>
  );
}
