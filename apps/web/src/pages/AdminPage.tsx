import {
  Alert,
  Anchor,
  Button,
  Center,
  Code,
  Group,
  Loader,
  Paper,
  Progress,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  ENABLED_SPORTS,
  formatDuration,
  formatLocalDate,
  formatPace,
  type Job,
  type Sport,
} from '@rekordy/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  runJobChunk,
  startRecomputeAll,
  useDeletedEfforts,
  useInvalidateResults,
  useLatestRecomputeJob,
  useRestoreEffort,
} from '../api/records';
import { driveJob, jobPercent } from '../admin/jobRunner';
import { pl } from '../i18n/pl';
import { t } from '../i18n/template';

const a = pl.admin;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Recompute all efforts: starts (or resumes) the server job and asks for chunks until it is
 * done. Leaving the page stops after the current chunk; the job can then be resumed.
 */
function RecomputeSection() {
  const latest = useLatestRecomputeJob();
  const queryClient = useQueryClient();
  const invalidateResults = useInvalidateResults();
  const [live, setLive] = useState<Job | null>(null);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const run = async () => {
    setRunning(true);
    setFailed(false);
    try {
      const started = await startRecomputeAll();
      setLive(started);
      const job = await driveJob(started, {
        runChunk: runJobChunk,
        onProgress: setLive,
        isCancelled: () => cancelled.current,
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
      if (job.status === 'done') {
        notifications.show({
          color: 'green',
          message: t(a.recompute.finished, { count: job.processed }),
        });
      }
    } catch {
      setFailed(true);
    } finally {
      if (!cancelled.current) {
        setRunning(false);
        await queryClient.invalidateQueries({ queryKey: ['admin'] });
        await invalidateResults();
      }
    }
  };

  const job = live ?? latest.data ?? null;
  const r = a.recompute;
  let status: ReactNode = null;
  if (latest.isError && !live) {
    status = <Alert color="red">{r.loadFailed}</Alert>;
  } else if (job && (running || job.status === 'running')) {
    status = (
      <Stack gap={4}>
        <Progress value={jobPercent(job)} animated={running} />
        <Text size="sm">
          {running
            ? job.busy
              ? r.busy
              : t(r.running, { processed: job.processed, total: job.total })
            : t(r.interrupted, { processed: job.processed, total: job.total })}
        </Text>
      </Stack>
    );
  } else if (job?.status === 'done' && job.finishedAt) {
    status = (
      <Text size="sm">
        {t(r.lastRun, { date: formatDateTime(job.finishedAt), count: job.processed })}
      </Text>
    );
  } else if (latest.isSuccess) {
    status = (
      <Text size="sm" c="dimmed">
        {r.never}
      </Text>
    );
  }

  const interrupted = !running && job?.status === 'running';

  return (
    <Paper withBorder p="md">
      <Stack>
        <Title order={3} size="h4">
          {r.title}
        </Title>
        <Text size="sm" c="dimmed">
          {r.description}
        </Text>
        {status}
        {failed && <Alert color="red">{r.failed}</Alert>}
        {job?.error && (
          <Alert color="yellow" title={r.errors}>
            <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
              {job.error}
            </Text>
          </Alert>
        )}
        <Group>
          <Button onClick={() => void run()} loading={running} disabled={latest.isPending}>
            {interrupted ? r.resume : r.start}
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          {r.cli}
          <Code>node dist/tools.cjs recompute-all</Code>
        </Text>
      </Stack>
    </Paper>
  );
}

function DeletedSection() {
  const [sport, setSport] = useState<Sport | 'all'>('all');
  const query = useDeletedEfforts(sport === 'all' ? undefined : sport);
  const restore = useRestoreEffort();
  const d = a.deleted;
  const c = d.columns;

  const doRestore = (id: number) =>
    restore.mutate(id, {
      onSuccess: (effort) =>
        notifications.show(
          effort
            ? { color: 'green', message: d.restored }
            : { color: 'yellow', message: d.restoredGone },
        ),
      onError: () => notifications.show({ color: 'red', message: d.actionFailed }),
    });

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <Center py="md">
        <Loader size="sm" />
      </Center>
    );
  } else if (query.isError) {
    body = <Alert color="red">{d.loadFailed}</Alert>;
  } else if (query.data.length === 0) {
    body = <Text c="dimmed">{d.empty}</Text>;
  } else {
    body = (
      <Table.ScrollContainer minWidth={760}>
        <Table verticalSpacing="xs" fz="sm" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{c.sport}</Table.Th>
              <Table.Th>{c.distance}</Table.Th>
              <Table.Th>{c.pace}</Table.Th>
              <Table.Th>{c.duration}</Table.Th>
              <Table.Th>{c.date}</Table.Th>
              <Table.Th>{c.activity}</Table.Th>
              <Table.Th>{c.deletedAt}</Table.Th>
              <Table.Th>{c.actions}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {query.data.map((effort) => (
              <Table.Tr key={effort.effortId}>
                <Table.Td>{pl.sports[effort.sport]}</Table.Td>
                <Table.Td>{pl.distances[effort.distanceKey]}</Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  {formatPace(effort.paceSPerKm, { unit: true })}
                  {effort.isTolerance ? ' *' : ''}
                </Table.Td>
                <Table.Td>{formatDuration(effort.durationS)}</Table.Td>
                <Table.Td>{formatLocalDate(effort.localDate)}</Table.Td>
                <Table.Td>
                  <Anchor component={Link} to={`/activities/${effort.activityId}`} size="sm">
                    {effort.activityName}
                  </Anchor>
                </Table.Td>
                <Table.Td>{formatDateTime(effort.deletedAt)}</Table.Td>
                <Table.Td>
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => doRestore(effort.effortId)}
                    loading={restore.isPending && restore.variables === effort.effortId}
                  >
                    {d.restore}
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    );
  }

  return (
    <Paper withBorder p="md">
      <Stack>
        <Title order={3} size="h4">
          {d.title}
        </Title>
        <Text size="sm" c="dimmed">
          {d.description}
        </Text>
        <SegmentedControl
          value={sport}
          onChange={(value) => setSport(value as Sport | 'all')}
          data={[
            { value: 'all', label: pl.sports.all },
            ...ENABLED_SPORTS.map((s) => ({ value: s, label: pl.sports[s] })),
          ]}
          style={{ alignSelf: 'flex-start' }}
        />
        {body}
      </Stack>
    </Paper>
  );
}

/** `/admin` (editor only): maintenance tasks (PLAN.md 3.2). */
export function AdminPage() {
  return (
    <Stack>
      <Title order={2}>{pl.pages.admin.title}</Title>
      <RecomputeSection />
      <DeletedSection />
    </Stack>
  );
}
