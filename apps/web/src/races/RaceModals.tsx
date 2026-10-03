import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  compareNamesPl,
  formatDistanceInput,
  type ActivityDetail,
  type ActivityPatchInput,
  type EventListItem,
  type Sport,
  type ValidationCode,
  type ValidationIssue,
} from '@rekordy/core';
import { useState } from 'react';
import { useActivity, usePatchActivity } from '../api/activities';
import { ApiError } from '../api/client';
import { useCreateEvent, useDeleteEvent, useMergeEvents, usePatchEvent } from '../api/events';
import { choiceOf, eventAssignment, type EventChoice } from '../events/eventChoice';
import { EventPicker } from '../events/EventPicker';
import { pl } from '../i18n/pl';
import { t } from '../i18n/template';
import {
  eventFormValues,
  formatEventDistance,
  parseEventForm,
  type EventFormValues,
} from './races';

const r = pl.races;

function errorMessage(error: unknown): string {
  return error instanceof ApiError && error.status !== 0 ? error.message : r.actionFailed;
}

function failed(error: unknown) {
  notifications.show({ color: 'red', message: errorMessage(error) });
}

function issuesOf(error: unknown): ValidationIssue[] {
  if (!(error instanceof ApiError) || error.status !== 400) return [];
  return (error.body as { issues?: ValidationIssue[] } | null)?.issues ?? [];
}

/**
 * New event (optionally made from a race without an event, which is assigned to it) or an
 * edit of the name and the distance (Q9: empty = computed from the editions).
 */
export function EventFormModal({
  sport,
  event,
  fromActivity,
  onClose,
  onCreated,
}: {
  sport: Sport;
  /** The event to edit; absent when creating one. */
  event?: EventListItem;
  fromActivity?: { id: number; name: string };
  onClose: () => void;
  onCreated?: (id: number) => void;
}) {
  const m = r.eventModal;
  const [values, setValues] = useState<EventFormValues>(() =>
    eventFormValues(event ?? null, fromActivity?.name),
  );
  const [errors, setErrors] = useState<Partial<Record<keyof EventFormValues, ValidationCode>>>({});
  const create = useCreateEvent();
  const patch = usePatchEvent();

  const set = (field: keyof EventFormValues) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const submit = () => {
    const result = parseEventForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const { name, displayDistanceM } = result;
    if (event?.id != null) {
      patch.mutate(
        { id: event.id, patch: { name, displayDistanceM } },
        {
          onSuccess: () => {
            notifications.show({ color: 'green', message: r.saved });
            onClose();
          },
          onError: failed,
        },
      );
      return;
    }
    create.mutate(
      {
        sport,
        name,
        displayDistanceM,
        ...(fromActivity ? { activityIds: [fromActivity.id] } : {}),
      },
      {
        onSuccess: (created) => {
          notifications.show({ color: 'green', message: t(r.created, { name: created.name }) });
          onCreated?.(created.id);
          onClose();
        },
        onError: failed,
      },
    );
  };

  const computed = event?.computedDistanceM ?? null;
  return (
    <Modal opened onClose={onClose} title={event ? m.editTitle : m.createTitle} centered>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Stack>
          <TextInput
            label={m.name}
            value={values.name}
            onChange={(e) => set('name')(e.currentTarget.value)}
            error={errors.name && pl.validation[errors.name]}
            withAsterisk
            data-autofocus
          />
          <TextInput
            label={m.distance}
            description={
              computed === null
                ? m.distanceHint
                : t(m.distanceComputed, { distance: formatEventDistance(computed) })
            }
            value={values.distance}
            onChange={(e) => set('distance')(e.currentTarget.value)}
            error={errors.distance && pl.validation[errors.distance]}
            inputMode="decimal"
            placeholder={computed === null ? undefined : formatDistanceInput(computed)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {m.cancel}
            </Button>
            <Button type="submit" loading={create.isPending || patch.isPending}>
              {m.submit}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Moves the editions of `event` into another event of the sport and deletes `event`. */
export function MergeModal({
  event,
  events,
  onClose,
  onMerged,
}: {
  event: EventListItem;
  /** The sport's list; the other events are the targets. */
  events: readonly EventListItem[];
  onClose: () => void;
  onMerged: (targetId: number) => void;
}) {
  const m = r.mergeModal;
  const [target, setTarget] = useState<string | null>(null);
  const merge = useMergeEvents();
  const targets = events
    .filter((e) => e.id !== null && e.id !== event.id)
    .sort((a, b) => compareNamesPl(a.name, b.name))
    .map((e) => ({ value: String(e.id), label: e.name }));

  const confirm = () => {
    if (event.id === null || target === null) return;
    const targetId = Number(target);
    merge.mutate(
      { id: event.id, targetId },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: r.merged });
          onMerged(targetId);
          onClose();
        },
        onError: failed,
      },
    );
  };

  return (
    <Modal opened onClose={onClose} title={m.title} centered>
      <Stack>
        <Text size="sm">{t(m.body, { name: event.name })}</Text>
        {targets.length === 0 ? (
          <Text size="sm" c="dimmed">
            {m.noTargets}
          </Text>
        ) : (
          <Select
            label={m.target}
            data={targets}
            value={target}
            onChange={setTarget}
            searchable
            data-autofocus
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {m.cancel}
          </Button>
          <Button onClick={confirm} disabled={target === null} loading={merge.isPending}>
            {m.confirm}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function DeleteEventModal({
  event,
  onClose,
}: {
  event: EventListItem;
  onClose: () => void;
}) {
  const m = r.deleteModal;
  const remove = useDeleteEvent();
  const confirm = () => {
    if (event.id === null) return;
    remove.mutate(event.id, {
      onSuccess: () => {
        notifications.show({ color: 'green', message: r.deleted });
        onClose();
      },
      onError: failed,
    });
  };
  return (
    <Modal opened onClose={onClose} title={m.title} centered>
      <Stack>
        <Text size="sm">
          {event.editionCount > 0
            ? t(m.body, { name: event.name, count: event.editionCount })
            : t(m.bodyEmpty, { name: event.name })}
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

/**
 * An edition: its event (move to another one, a new one or none), edition label and notes.
 * Also assigns a race without an event.
 */
export function EditionModal({ activityId, onClose }: { activityId: number; onClose: () => void }) {
  const query = useActivity(activityId);
  return (
    <Modal
      opened
      onClose={onClose}
      title={query.data ? t(r.editionModal.title, { name: query.data.name }) : ''}
      centered
      size="lg"
    >
      {query.isPending ? (
        <Center py="md">
          <Loader size="sm" />
        </Center>
      ) : query.isError ? (
        <Alert color="red">{r.detailFailed}</Alert>
      ) : (
        <EditionForm key={query.data.id} activity={query.data} onClose={onClose} />
      )}
    </Modal>
  );
}

function EditionForm({ activity, onClose }: { activity: ActivityDetail; onClose: () => void }) {
  const m = r.editionModal;
  const [name, setName] = useState(activity.name);
  const [event, setEvent] = useState<EventChoice>(choiceOf(activity.eventId, activity.eventName));
  const [editionLabel, setEditionLabel] = useState(activity.editionLabel ?? '');
  const [notes, setNotes] = useState(activity.notes ?? '');
  const [eventError, setEventError] = useState<string | undefined>();
  const patch = usePatchActivity();

  const submit = () => {
    const body: ActivityPatchInput = { ...eventAssignment(event), editionLabel, notes };
    if (name.trim() !== activity.name) body.name = name;
    patch.mutate(
      { id: activity.id, patch: body },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: r.saved });
          onClose();
        },
        onError: (error) => {
          const issue = issuesOf(error).find((i) => i.path[0] === 'eventId');
          if (issue) setEventError(pl.validation[issue.code] ?? pl.validation.generic);
          else failed(error);
        },
      },
    );
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Stack>
        <EventPicker
          sport={activity.sport}
          value={event}
          onChange={(choice) => {
            setEvent(choice);
            setEventError(undefined);
          }}
          activityName={name}
          onRename={setName}
          error={eventError}
        />
        <TextInput
          label={m.editionLabel}
          description={m.editionLabelHint}
          value={editionLabel}
          onChange={(e) => setEditionLabel(e.currentTarget.value)}
          maxLength={100}
        />
        <Textarea
          label={m.notes}
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          autosize
          minRows={3}
          maxLength={5000}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {m.cancel}
          </Button>
          <Button type="submit" loading={patch.isPending}>
            {m.submit}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
