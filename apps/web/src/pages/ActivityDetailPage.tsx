import {
  Alert,
  Anchor,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { formatDistance, formatDuration, formatLocalDate, formatPace } from '@rekordy/core';
import { Link, useLocation, useParams } from 'react-router';
import { useActivity } from '../api/activities';
import { useCanEdit } from '../auth/auth';
import { EffortsTable } from '../components/EffortsTable';
import { SplitsView } from '../components/SplitsView';
import { pl } from '../i18n/pl';
import { t } from '../i18n/template';

const d = pl.activityDetail;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600}>{value}</Text>
    </div>
  );
}

/** Start time in the browser's time zone, `HH:MM`. */
function startTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

/** `/activities/:id`: read-only detail with splits and results. */
export function ActivityDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const canEdit = useCanEdit();
  const query = useActivity(Number(id));
  const backTo = (location.state as { from?: string } | null)?.from ?? '/activities';

  if (query.isPending) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }
  if (query.isError) return <Alert color="red">{d.loadFailed}</Alert>;
  const activity = query.data;
  const visibleEfforts = activity.efforts.filter((e) => !e.isDeleted);

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Anchor component={Link} to={backTo} size="sm">
            ← {d.back}
          </Anchor>
          <Title order={2}>{activity.name}</Title>
          <Group gap="xs">
            <Badge variant="light">{pl.sports[activity.sport]}</Badge>
            {activity.isRace && <Badge color="grape">{d.race}</Badge>}
            {activity.isHidden && <Badge color="gray">{d.hidden}</Badge>}
            {activity.eventId !== null && activity.eventName !== null && (
              <Anchor
                component={Link}
                to={`/races?${new URLSearchParams({ sport: activity.sport, event: `e${activity.eventId}` })}`}
                size="sm"
              >
                {t(d.event, { name: activity.eventName })}
                {activity.editionLabel && `, ${t(d.edition, { label: activity.editionLabel })}`}
              </Anchor>
            )}
            {activity.activityUrl && (
              <Anchor
                href={activity.activityUrl}
                target="_blank"
                rel="noopener noreferrer"
                size="sm"
              >
                {d.openLink} ↗
              </Anchor>
            )}
          </Group>
        </Stack>
        {canEdit && (
          <Button
            component={Link}
            to={`/activities/${activity.id}/edit`}
            state={{ from: location.pathname }}
            variant="light"
          >
            {d.edit}
          </Button>
        )}
      </Group>

      <Paper withBorder p="md">
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <Stat label={d.stats.date} value={formatLocalDate(activity.localDate)} />
          {activity.startTimeUtc && (
            <Stat label={d.stats.start} value={startTime(activity.startTimeUtc)} />
          )}
          <Stat label={d.stats.distance} value={formatDistance(activity.distanceM)} />
          <Stat
            label={d.stats.duration}
            value={activity.durationS === null ? '—' : formatDuration(activity.durationS)}
          />
          {activity.elapsedS !== null &&
            activity.durationS !== null &&
            activity.elapsedS > activity.durationS + 1 && (
              <Stat label={d.stats.elapsed} value={formatDuration(activity.elapsedS)} />
            )}
          <Stat
            label={d.stats.pace}
            value={
              activity.paceSPerKm === null ? '—' : formatPace(activity.paceSPerKm, { unit: true })
            }
          />
          <Stat
            label={d.stats.elevationGain}
            value={activity.elevationGainM === null ? '—' : `${activity.elevationGainM} m`}
          />
          <Stat label={d.stats.source} value={d.sources[activity.source]} />
        </SimpleGrid>
      </Paper>

      {activity.notes && (
        <Stack gap={4}>
          <Title order={4}>{d.notes}</Title>
          <Text style={{ whiteSpace: 'pre-wrap' }}>{activity.notes}</Text>
        </Stack>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Stack gap="xs">
          <Title order={4}>{pl.efforts.title}</Title>
          <EffortsTable efforts={visibleEfforts} />
        </Stack>
        <Stack gap="xs">
          <Title order={4}>{pl.splits.title}</Title>
          <SplitsView splits={activity.splits ?? []} />
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
