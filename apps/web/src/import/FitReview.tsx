import {
  Alert,
  Button,
  Checkbox,
  Group,
  List,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import {
  computeEfforts,
  ENABLED_SPORTS,
  formatDistance,
  formatDuration,
  formatLocalDate,
  formatPace,
  type ValidationCode,
} from '@rekordy/core';
import { useMemo } from 'react';
import { EffortsTable } from '../components/EffortsTable';
import { SplitsView } from '../components/SplitsView';
import { pl } from '../i18n/pl';
import { t } from '../i18n/template';
import { averagePace, type ImportItem, type ReviewValues } from './importState';

const r = pl.import.fit.review;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Start time in the activity's own time zone, `HH:MM`. */
function localStartTime(startTimeUtc: string, utcOffsetS: number): string {
  const local = new Date(Date.parse(startTimeUtc) + utcOffsetS * 1000);
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

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

function validationText(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return pl.validation[code as ValidationCode] ?? pl.validation.generic;
}

export type ReviewErrors = Partial<Record<keyof ReviewValues, string>>;

/** Review step of one FIT file: what was detected, editable fields, approve / skip. */
export function FitReview({
  item,
  position,
  total,
  errors,
  saving,
  onChange,
  onApprove,
  onSkip,
}: {
  item: ImportItem;
  position: number;
  total: number;
  errors: ReviewErrors;
  saving: boolean;
  onChange: (values: Partial<ReviewValues>) => void;
  onApprove: () => void;
  onSkip: () => void;
}) {
  const activity = item.activity!;
  const details = item.details!;
  const values = item.values!;
  const efforts = useMemo(
    () => computeEfforts({ ...activity, sport: values.sport }),
    [activity, values.sport],
  );
  const sportOptions = [...new Set([...ENABLED_SPORTS, activity.sport])].map((sport) => ({
    value: sport,
    label: pl.sports[sport],
  }));
  const needsConfirmation = item.status === 'similar' && !values.confirmSimilar;
  const s = r.stats;

  const sportSource =
    details.sportSource === 'elevation'
      ? t(r.sportSources.elevation, {
          perKm: Math.round(((activity.elevationGainM ?? 0) / activity.distanceM) * 1000),
        })
      : r.sportSources[details.sportSource];

  const actions = (
    <>
      <Button variant="default" onClick={onSkip} disabled={saving}>
        {r.skip}
      </Button>
      <Button onClick={onApprove} loading={saving} disabled={needsConfirmation}>
        {r.approve}
      </Button>
    </>
  );

  return (
    <Paper withBorder p="md">
      <Stack>
        {/* The actions are repeated at the top, so a long review needs no scrolling. */}
        <Group justify="space-between" align="flex-start" gap="sm">
          <Title order={4}>{t(r.title, { current: position, total, file: item.file.name })}</Title>
          <Group gap="xs">{actions}</Group>
        </Group>

        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <Stat label={s.date} value={formatLocalDate(activity.localDate)} />
          <Stat label={s.start} value={localStartTime(activity.startTimeUtc, details.utcOffsetS)} />
          <Stat label={s.distance} value={formatDistance(activity.distanceM)} />
          <Stat label={s.duration} value={formatDuration(activity.durationS)} />
          <Stat label={s.pace} value={formatPace(averagePace(activity), { unit: true })} />
          {activity.elapsedS !== undefined && activity.elapsedS > activity.durationS + 1 && (
            <Stat label={s.elapsed} value={formatDuration(activity.elapsedS)} />
          )}
          <Stat
            label={s.elevationGain}
            value={activity.elevationGainM === undefined ? '—' : `${activity.elevationGainM} m`}
          />
          <Stat label={s.profile} value={details.sportProfileName ?? '—'} />
        </SimpleGrid>

        <Stack gap={2}>
          <Text size="sm">
            {t(r.detectedSport, { sport: pl.sports[activity.sport] })} ({sportSource})
          </Text>
          <Text size="sm" c={activity.isRace ? undefined : 'dimmed'}>
            {details.raceSource === 'profile_name'
              ? t(r.raceDetected, { profile: details.sportProfileName ?? '' })
              : r.raceNotDetected}
          </Text>
        </Stack>

        {item.status === 'similar' && item.similar && (
          <Alert color="yellow" title={r.similarTitle}>
            <Stack gap="xs">
              <List size="sm">
                {item.similar.map((similar) => (
                  <List.Item key={similar.id}>
                    {similar.name}, {formatLocalDate(similar.localDate)},{' '}
                    {formatDistance(similar.distanceM)}
                  </List.Item>
                ))}
              </List>
              <Checkbox
                label={r.confirmSimilar}
                checked={values.confirmSimilar}
                onChange={(event) => onChange({ confirmSimilar: event.currentTarget.checked })}
              />
            </Stack>
          </Alert>
        )}

        {item.uploadError && <Alert color="red">{item.uploadError}</Alert>}

        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label={r.fields.name}
            value={values.name}
            onChange={(event) => onChange({ name: event.currentTarget.value })}
            error={validationText(errors.name)}
            required
          />
          <Select
            label={r.fields.sport}
            data={sportOptions}
            value={values.sport}
            onChange={(value) => value && onChange({ sport: value as ReviewValues['sport'] })}
            allowDeselect={false}
          />
          <TextInput
            label={r.fields.activityUrl}
            description={r.fields.activityUrlHint}
            placeholder="https://connect.garmin.com/app/activity/…"
            value={values.activityUrl}
            onChange={(event) => onChange({ activityUrl: event.currentTarget.value })}
            error={validationText(errors.activityUrl)}
          />
          <Stack gap="xs" justify="flex-end">
            <Checkbox
              label={r.fields.isRace}
              checked={values.isRace}
              onChange={(event) => onChange({ isRace: event.currentTarget.checked })}
            />
            <Checkbox
              label={r.fields.isHidden}
              checked={values.isHidden}
              onChange={(event) => onChange({ isHidden: event.currentTarget.checked })}
            />
          </Stack>
        </SimpleGrid>
        <Textarea
          label={r.fields.notes}
          value={values.notes}
          onChange={(event) => onChange({ notes: event.currentTarget.value })}
          error={validationText(errors.notes)}
          autosize
          minRows={2}
        />

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <Stack gap="xs">
            <Title order={5}>{pl.efforts.title}</Title>
            <EffortsTable efforts={efforts} />
          </Stack>
          <Stack gap="xs">
            <Title order={5}>{pl.splits.title}</Title>
            <SplitsView splits={activity.splits ?? []} />
          </Stack>
        </SimpleGrid>

        <Group justify="flex-end">{actions}</Group>
      </Stack>
    </Paper>
  );
}
