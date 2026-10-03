import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconLayoutColumns, IconLayoutRows } from '@tabler/icons-react';
import {
  DISTANCES,
  ENABLED_SPORTS,
  formatDistance,
  formatDuration,
  formatLocalDate,
  formatPace,
  minQualifyingDistanceM,
  toleranceApplies,
  type DistanceKey,
  type DistanceRecords,
  type RecordEntry,
  type Sport,
} from '@rekordy/core';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { useDeleteEffort, usePatchEffort, useRecords, useResetEffort } from '../api/records';
import { useCanEdit } from '../auth/auth';
import { TapTooltip } from '../components/TapTooltip';
import { pl } from '../i18n/pl';
import { t } from '../i18n/template';
import {
  buildEffortPatch,
  effortFormValues,
  effortPreview,
  type EffortFormErrors,
  type EffortFormValues,
} from '../records/effortForm';

const r = pl.records;

type Selected = { entry: RecordEntry; distanceKey: DistanceKey };

function readSport(params: URLSearchParams): Sport {
  const sport = params.get('sport') as Sport | null;
  return sport && ENABLED_SPORTS.includes(sport) ? sport : ENABLED_SPORTS[0]!;
}

function PaceCell({ entry }: { entry: RecordEntry }) {
  const pace = formatPace(entry.paceSPerKm, { unit: true });
  if (!entry.isTolerance) return <>{pace}</>;
  return (
    <TapTooltip
      label={t(pl.efforts.tolerance, { distance: formatDistance(entry.actualDistanceM) })}
    >
      {pace} *
    </TapTooltip>
  );
}

function DistanceCard({
  records,
  canEdit,
  onEdit,
  onDelete,
}: {
  records: DistanceRecords;
  canEdit: boolean;
  onEdit: (selected: Selected) => void;
  onDelete: (selected: Selected) => void;
}) {
  const c = r.columns;
  const { distanceKey } = records;
  return (
    <Paper withBorder p="md">
      <Title order={3} size="h4" mb="xs">
        {pl.distances[distanceKey]}
      </Title>
      {/* On a phone the date moves under the activity name, so the table fits without scrolling. */}
      <Table.ScrollContainer minWidth={canEdit ? 520 : 300}>
        <Table verticalSpacing="xs" fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={40} aria-label={c.place} />
              <Table.Th>{c.pace}</Table.Th>
              <Table.Th>{c.duration}</Table.Th>
              <Table.Th visibleFrom="sm">{c.date}</Table.Th>
              <Table.Th>{c.activity}</Table.Th>
              {canEdit && <Table.Th>{c.actions}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {records.entries.map((entry, index) => (
              <Table.Tr key={entry.effortId}>
                <Table.Td fz="lg" aria-label={t(r.place, { place: index + 1 })}>
                  {r.medals[index] ?? index + 1}
                </Table.Td>
                <Table.Td fw={600} style={{ whiteSpace: 'nowrap' }}>
                  <PaceCell entry={entry} />
                </Table.Td>
                <Table.Td c={entry.durationS === null ? 'dimmed' : undefined}>
                  {entry.durationS === null ? '—' : formatDuration(entry.durationS)}
                </Table.Td>
                <Table.Td visibleFrom="sm" style={{ whiteSpace: 'nowrap' }}>
                  {formatLocalDate(entry.localDate)}
                </Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Anchor component={Link} to={`/activities/${entry.activityId}`} size="sm">
                      {entry.activityName}
                    </Anchor>
                    {entry.activityUrl && (
                      <Anchor
                        href={entry.activityUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        size="sm"
                        title={r.openLink}
                        aria-label={r.openLink}
                      >
                        ↗
                      </Anchor>
                    )}
                    {canEdit && entry.isEdited && (
                      <Text span c="dimmed" fz="sm" title={r.edited} aria-label={r.edited}>
                        ✎
                      </Text>
                    )}
                  </Group>
                  <Text hiddenFrom="sm" c="dimmed" fz="xs">
                    {formatLocalDate(entry.localDate)}
                  </Text>
                </Table.Td>
                {canEdit && (
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        onClick={() => onEdit({ entry, distanceKey })}
                      >
                        {r.edit}
                      </Button>
                      <Button
                        variant="subtle"
                        color="red"
                        size="compact-sm"
                        onClick={() => onDelete({ entry, distanceKey })}
                      >
                        {r.delete}
                      </Button>
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}

type CardLayout = 'stacked' | 'sideBySide';

/** Distance cards one under another or two per row (from lg up); remembered per browser. */
function useCardLayout() {
  return useLocalStorage<CardLayout>({
    key: 'rs.records.layout',
    defaultValue: 'sideBySide',
    getInitialValueInEffect: false,
  });
}

/** `/records`: the top 3 per distance for each sport (PLAN.md 4.2, 8). The default page. */
export function RecordsPage() {
  const [params, setParams] = useSearchParams();
  const sport = readSport(params);
  const canEdit = useCanEdit();
  const query = useRecords(sport);
  const [toEdit, setToEdit] = useState<Selected | null>(null);
  const [toDelete, setToDelete] = useState<Selected | null>(null);
  const [layout, setLayout] = useCardLayout();
  const stacked = layout === 'stacked';
  const layoutLabel = stacked ? r.layout.toSideBySide : r.layout.toStacked;
  const LayoutIcon = stacked ? IconLayoutColumns : IconLayoutRows;

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <Center py="xl">
        <Loader />
      </Center>
    );
  } else if (query.isError) {
    body = <Alert color="red">{r.loadFailed}</Alert>;
  } else if (query.data.distances.length === 0) {
    body = <Text c="dimmed">{r.empty}</Text>;
  } else {
    body = (
      <SimpleGrid cols={stacked ? 1 : { base: 1, lg: 2 }} spacing="md">
        {query.data.distances.map((records) => (
          <DistanceCard
            key={records.distanceKey}
            records={records}
            canEdit={canEdit}
            onEdit={setToEdit}
            onDelete={setToDelete}
          />
        ))}
      </SimpleGrid>
    );
  }

  return (
    <Stack>
      <Group justify="space-between" align="center">
        <Title order={2}>{pl.pages.records.title}</Title>
        {/* Below lg the cards are always stacked, so the switch is hidden there. */}
        <Tooltip label={layoutLabel} withArrow>
          <ActionIcon
            variant="light"
            size="lg"
            visibleFrom="lg"
            aria-label={layoutLabel}
            onClick={() => setLayout(stacked ? 'sideBySide' : 'stacked')}
          >
            <LayoutIcon size={20} stroke={1.7} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Tabs
        value={sport}
        onChange={(value) =>
          setParams(value && value !== ENABLED_SPORTS[0] ? { sport: value } : {})
        }
      >
        <Tabs.List>
          {ENABLED_SPORTS.map((s) => (
            <Tabs.Tab key={s} value={s}>
              {pl.sports[s]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      {body}
      {canEdit && (
        <>
          <EditEffortModal
            key={toEdit?.entry.effortId ?? 'none'}
            selected={toEdit}
            onClose={() => setToEdit(null)}
          />
          <DeleteEffortModal selected={toDelete} onClose={() => setToDelete(null)} />
        </>
      )}
    </Stack>
  );
}

function distanceHint(distanceKey: DistanceKey): string {
  const { targetM } = DISTANCES[distanceKey];
  const target = formatDistance(targetM, { unit: false, decimals: targetM % 1000 ? 4 : 0 });
  const m = r.editModal;
  if (!toleranceApplies(targetM)) return t(m.distanceHintNoTolerance, { target });
  const min = formatDistance(minQualifyingDistanceM(targetM), { unit: false });
  return t(m.distanceHint, { min, target });
}

function EditEffortModal({
  selected,
  onClose,
}: {
  selected: Selected | null;
  onClose: () => void;
}) {
  const initial = selected ? effortFormValues(selected.entry) : null;
  const [values, setValues] = useState<EffortFormValues | null>(initial);
  const [errors, setErrors] = useState<EffortFormErrors>({});
  const patch = usePatchEffort();
  const reset = useResetEffort();
  const m = r.editModal;

  const set = (field: keyof EffortFormValues) => (value: string) => {
    setValues((v) => (v ? { ...v, [field]: value } : v));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };
  const errorText = (field: keyof EffortFormValues) => {
    const code = errors[field];
    return code ? pl.validation[code] : undefined;
  };
  const failed = (error: unknown) =>
    notifications.show({
      color: 'red',
      message: error instanceof ApiError && error.status !== 0 ? error.message : r.actionFailed,
    });

  const submit = () => {
    if (!selected || !values || !initial) return;
    const result = buildEffortPatch(selected.distanceKey, values, initial);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (!result.patch) {
      onClose();
      return;
    }
    patch.mutate(
      { id: selected.entry.effortId, patch: result.patch },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: r.saved });
          onClose();
        },
        onError: failed,
      },
    );
  };

  const doReset = () => {
    if (!selected) return;
    reset.mutate(selected.entry.effortId, {
      onSuccess: () => {
        notifications.show({ color: 'green', message: r.resetDone });
        onClose();
      },
      onError: failed,
    });
  };

  const preview = selected && values ? effortPreview(selected.distanceKey, values) : null;
  const canReset = selected?.entry.origin === 'computed' && selected.entry.isEdited;

  return (
    <Modal
      opened={selected !== null}
      onClose={onClose}
      title={selected && t(m.title, { distance: pl.distances[selected.distanceKey] })}
      centered
    >
      {selected && values && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Stack>
            <Text size="sm" c="dimmed">
              {t(m.activity, {
                name: selected.entry.activityName,
                date: formatLocalDate(selected.entry.localDate),
              })}
            </Text>
            <TextInput
              label={m.duration}
              description={m.durationHint}
              value={values.duration}
              onChange={(e) => set('duration')(e.currentTarget.value)}
              error={errorText('duration')}
              inputMode="numeric"
              data-autofocus
            />
            <TextInput
              label={m.distance}
              description={distanceHint(selected.distanceKey)}
              value={values.distance}
              onChange={(e) => set('distance')(e.currentTarget.value)}
              error={errorText('distance')}
              inputMode="decimal"
            />
            <TextInput
              label={m.activityUrl}
              description={m.activityUrlHint}
              value={values.activityUrl}
              onChange={(e) => set('activityUrl')(e.currentTarget.value)}
              error={errorText('activityUrl')}
              type="url"
            />
            {preview && (
              <Text size="sm">
                {t(preview.isTolerance ? m.previewTolerance : m.preview, {
                  pace: formatPace(preview.paceSPerKm, { unit: true }),
                })}
              </Text>
            )}
            <Group justify="space-between">
              {canReset ? (
                <Button
                  variant="subtle"
                  color="gray"
                  onClick={doReset}
                  loading={reset.isPending}
                  title={m.resetHint}
                >
                  {m.reset}
                </Button>
              ) : (
                <span />
              )}
              <Group gap="xs">
                <Button variant="default" onClick={onClose}>
                  {m.cancel}
                </Button>
                <Button type="submit" loading={patch.isPending}>
                  {m.submit}
                </Button>
              </Group>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}

function DeleteEffortModal({
  selected,
  onClose,
}: {
  selected: Selected | null;
  onClose: () => void;
}) {
  const remove = useDeleteEffort();
  const m = r.deleteModal;

  const confirm = () => {
    if (!selected) return;
    remove.mutate(selected.entry.effortId, {
      onSuccess: () => {
        notifications.show({ color: 'green', message: r.deleted });
        onClose();
      },
      onError: () => notifications.show({ color: 'red', message: r.actionFailed }),
    });
  };

  return (
    <Modal opened={selected !== null} onClose={onClose} title={m.title} centered>
      <Stack>
        <Text size="sm">
          {selected &&
            t(m.body, {
              pace: formatPace(selected.entry.paceSPerKm, { unit: true }),
              name: selected.entry.activityName,
              date: formatLocalDate(selected.entry.localDate),
            })}
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
