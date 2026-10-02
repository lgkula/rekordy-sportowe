import {
  ActionIcon,
  Alert,
  Button,
  Center,
  Checkbox,
  Group,
  List,
  Loader,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput, TimeInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import {
  ENABLED_SPORTS,
  formatDistance,
  formatLocalDate,
  SPORTS,
  type ActivityCreate,
  type ActivityDetail,
  type ActivityListItem,
  type DuplicateConflict,
  type Sport,
} from '@rekordy/core';
import { useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useActivity, useCreateActivity, usePatchActivity } from '../api/activities';
import { ApiError } from '../api/client';
import {
  detailToFormValues,
  effortKeysFor,
  emptyFormValues,
  parseActivityForm,
  toPatch,
  type ActivityFormValues,
  type FormMode,
} from '../activities/form';
import { pl } from '../i18n/pl';
import { t } from '../i18n/template';

const f = pl.activityForm.fields;

/** `DD.MM.YYYY` typed by hand → `YYYY-MM-DD`. */
function parsePolishDate(input: string): string | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(input.trim());
  if (!match) return null;
  const [, d, m, y] = match;
  const iso = `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function describe(activity: ActivityListItem): string {
  return `${activity.name}, ${formatLocalDate(activity.localDate)}, ${formatDistance(activity.distanceM)}`;
}

/** `/activities/new` and `/activities/:id/edit`. */
export function ActivityFormPage() {
  const { id } = useParams();
  const activityId = id === undefined ? undefined : Number(id);
  const activity = useActivity(activityId);

  if (activityId === undefined) return <ActivityForm />;
  if (activity.isPending) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }
  if (activity.isError) return <Alert color="red">{pl.activityForm.loadFailed}</Alert>;
  return <ActivityForm key={activity.data.id} existing={activity.data} />;
}

function ActivityForm({ existing }: { existing?: ActivityDetail }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const backTo = (location.state as { from?: string } | null)?.from ?? '/activities';

  const initialSport = searchParams.get('sport');
  const [mode, setMode] = useState<FormMode>(
    existing?.source === 'manual_simple' ? 'simple' : 'full',
  );
  const form = useForm<ActivityFormValues>({
    initialValues: existing
      ? detailToFormValues(existing)
      : emptyFormValues(
          ENABLED_SPORTS.includes(initialSport as Sport) ? (initialSport as Sport) : undefined,
        ),
  });
  const create = useCreateActivity();
  const patch = usePatchActivity();
  const [similar, setSimilar] = useState<{ input: ActivityCreate; items: ActivityListItem[] }>();
  const [formError, setFormError] = useState<string | null>(null);

  // A disabled sport is offered only when editing an activity that already has it.
  const sports = SPORTS.filter((s) => ENABLED_SPORTS.includes(s) || s === existing?.sport);
  const saving = create.isPending || patch.isPending;

  const onSaved = () => {
    notifications.show({ color: 'green', message: pl.activityForm.saved });
    void navigate(backTo);
  };

  const onError = (error: unknown, input: ActivityCreate) => {
    if (error instanceof ApiError && error.status === 409) {
      const conflict = error.body as DuplicateConflict;
      if (conflict.code === 'similar_activity') {
        setSimilar({ input, items: conflict.similar });
        return;
      }
      setFormError(t(pl.activityForm.duplicate, { activity: describe(conflict.activity) }));
      return;
    }
    setFormError(pl.activityForm.saveFailed);
  };

  const save = (input: ActivityCreate, confirmDuplicate = false) => {
    setFormError(null);
    if (existing) {
      patch.mutate(
        { id: existing.id, patch: toPatch(input) },
        { onSuccess: onSaved, onError: (error) => onError(error, input) },
      );
    } else {
      create.mutate(
        { ...input, confirmDuplicate },
        { onSuccess: onSaved, onError: (error) => onError(error, input) },
      );
    }
  };

  const onSubmit = form.onSubmit((values) => {
    const result = parseActivityForm(values, mode);
    if (!result.ok) {
      form.setErrors(
        Object.fromEntries(
          Object.entries(result.errors).map(([field, code]) => [
            field,
            pl.validation[code] ?? pl.validation.generic,
          ]),
        ),
      );
      return;
    }
    form.clearErrors();
    save(result.input);
  });

  const effortKeyOptions = effortKeysFor(form.values.sport).map((key) => ({
    value: key,
    label: pl.distances[key],
  }));

  return (
    <Stack maw={760}>
      <Title order={2}>{existing ? pl.activityForm.titleEdit : pl.activityForm.titleNew}</Title>

      <form onSubmit={onSubmit} noValidate>
        <Stack>
          <SegmentedControl
            value={mode}
            onChange={(value) => {
              setMode(value as FormMode);
              form.clearErrors();
            }}
            data={[
              { value: 'full', label: pl.activityForm.modes.full },
              { value: 'simple', label: pl.activityForm.modes.simple },
            ]}
            style={{ alignSelf: 'flex-start' }}
          />

          {formError && <Alert color="red">{formError}</Alert>}

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {f.sport}
            </Text>
            <SegmentedControl
              value={form.values.sport}
              onChange={(value) => {
                const sport = value as Sport;
                form.setFieldValue('sport', sport);
                const key = form.values.effortKey;
                if (key !== '' && !effortKeysFor(sport).includes(key)) {
                  form.setFieldValue('effortKey', '');
                }
              }}
              data={sports.map((sport) => ({ value: sport, label: pl.sports[sport] }))}
              style={{ alignSelf: 'flex-start' }}
            />
          </Stack>

          <TextInput label={f.name} withAsterisk {...form.getInputProps('name')} />

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <DateInput
              label={f.date}
              withAsterisk
              valueFormat="DD.MM.YYYY"
              dateParser={parsePolishDate}
              value={form.values.localDate || null}
              onChange={(value) => form.setFieldValue('localDate', value ?? '')}
              error={form.errors.localDate}
            />
            {mode === 'full' && (
              <TimeInput label={f.startTime} {...form.getInputProps('startTime')} />
            )}
            <TextInput
              label={f.distance}
              withAsterisk
              inputMode="decimal"
              placeholder="5,0"
              {...form.getInputProps('distance')}
            />
            {mode === 'full' ? (
              <TextInput
                label={f.duration}
                description={f.durationHint}
                withAsterisk
                placeholder="24:35"
                {...form.getInputProps('duration')}
              />
            ) : (
              <TextInput
                label={f.simpleDuration}
                description={f.simpleDurationHint}
                placeholder="49:10"
                {...form.getInputProps('duration')}
              />
            )}
          </SimpleGrid>

          {mode === 'simple' && (
            <Paper withBorder p="md">
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Select
                  label={f.effortKey}
                  withAsterisk
                  data={effortKeyOptions}
                  value={form.values.effortKey || null}
                  onChange={(value) =>
                    form.setFieldValue(
                      'effortKey',
                      (value ?? '') as ActivityFormValues['effortKey'],
                    )
                  }
                  error={form.errors.effortKey}
                />
                <TextInput
                  label={f.effortDuration}
                  description={f.effortDurationHint}
                  withAsterisk
                  placeholder="21:30"
                  {...form.getInputProps('effortDuration')}
                />
              </SimpleGrid>
            </Paper>
          )}

          {mode === 'full' && (
            <>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label={f.elapsed}
                  description={f.elapsedHint}
                  {...form.getInputProps('elapsed')}
                />
                <TextInput
                  label={f.elevationGain}
                  inputMode="numeric"
                  {...form.getInputProps('elevationGain')}
                />
              </SimpleGrid>
              <Group>
                <Checkbox
                  label={f.isRace}
                  {...form.getInputProps('isRace', { type: 'checkbox' })}
                />
                <Checkbox
                  label={f.isHidden}
                  {...form.getInputProps('isHidden', { type: 'checkbox' })}
                />
              </Group>
              <TextInput
                label={f.editionLabel}
                description={f.editionLabelHint}
                {...form.getInputProps('editionLabel')}
              />
            </>
          )}

          <TextInput
            label={f.activityUrl}
            type="url"
            placeholder="https://www.strava.com/activities/…"
            {...form.getInputProps('activityUrl')}
          />

          {mode === 'full' && (
            <>
              <Textarea label={f.notes} autosize minRows={3} {...form.getInputProps('notes')} />
              <SplitsEditor form={form} />
            </>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={() => void navigate(backTo)}>
              {pl.activityForm.cancel}
            </Button>
            <Button type="submit" loading={saving}>
              {pl.activityForm.submit}
            </Button>
          </Group>
        </Stack>
      </form>

      <Modal
        opened={similar !== undefined}
        onClose={() => setSimilar(undefined)}
        title={pl.activityForm.similarModal.title}
        centered
      >
        <Stack>
          <Text size="sm">{pl.activityForm.similarModal.body}</Text>
          <List size="sm">
            {similar?.items.map((item) => (
              <List.Item key={item.id}>{describe(item)}</List.Item>
            ))}
          </List>
          <Text size="sm">{pl.activityForm.similarModal.question}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSimilar(undefined)}>
              {pl.activityForm.similarModal.cancel}
            </Button>
            <Button
              loading={create.isPending}
              onClick={() => {
                if (!similar) return;
                const { input } = similar;
                setSimilar(undefined);
                save(input, true);
              }}
            >
              {pl.activityForm.similarModal.confirm}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

type Form = ReturnType<typeof useForm<ActivityFormValues>>;

function SplitsEditor({ form }: { form: Form }) {
  const s = pl.activityForm.splits;
  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        {s.title}
      </Text>
      {form.values.splits.length === 0 && (
        <Text size="sm" c="dimmed">
          {s.empty}
        </Text>
      )}
      {form.values.splits.map((_split, index) => (
        <Group key={index} align="flex-start" wrap="nowrap" gap="xs">
          <Text size="sm" w={32} pt={30} ta="right">
            {index + 1}.
          </Text>
          <TextInput
            label={index === 0 ? s.distance : undefined}
            aria-label={s.distance}
            inputMode="decimal"
            style={{ flex: 1 }}
            {...form.getInputProps(`splits.${index}.distance`)}
          />
          <TextInput
            label={index === 0 ? s.duration : undefined}
            aria-label={s.duration}
            placeholder="4:35"
            style={{ flex: 1 }}
            {...form.getInputProps(`splits.${index}.duration`)}
          />
          <TextInput
            label={index === 0 ? s.elevationGain : undefined}
            aria-label={s.elevationGain}
            inputMode="numeric"
            style={{ flex: 1 }}
            {...form.getInputProps(`splits.${index}.elevationGain`)}
          />
          <ActionIcon
            variant="subtle"
            color="red"
            mt={index === 0 ? 28 : 4}
            onClick={() => form.removeListItem('splits', index)}
            aria-label={s.remove}
            title={s.remove}
          >
            ✕
          </ActionIcon>
        </Group>
      ))}
      <Button
        variant="light"
        size="xs"
        style={{ alignSelf: 'flex-start' }}
        onClick={() =>
          form.insertListItem('splits', { distance: '1', duration: '', elevationGain: '' })
        }
      >
        {s.add}
      </Button>
    </Stack>
  );
}
