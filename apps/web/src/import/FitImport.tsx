import {
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  type MantineColor,
} from '@mantine/core';
import { Dropzone, type FileRejection } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import {
  FIT_MAX_FILE_BYTES,
  formatDistance,
  formatLocalDate,
  type DuplicateConflict,
  type ValidationIssue,
} from '@rekordy/core';
import type { FitErrorCode } from '@rekordy/core/fit';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api/client';
import { checkImport, uploadFit } from '../api/imports';
import { pl } from '../i18n/pl';
import { t } from '../i18n/template';
import {
  applyCheckResult,
  applyParseResult,
  approvableWithoutReview,
  failedItem,
  isBusy,
  markBatchDuplicates,
  newItem,
  reviewField,
  reviewQueue,
  summarize,
  toCheckItem,
  toMeta,
  type ImportItem,
  type ImportStatus,
  type ReviewValues,
} from './importState';
import { FitReview, type ReviewErrors } from './FitReview';
import { parseFitInWorker, unzipInWorker } from './parseInWorker';
import { isZipName, ZIP_MAX_FILE_BYTES } from './zip';

const f = pl.import.fit;

const STATUS_COLORS: Record<ImportStatus, MantineColor> = {
  parsing: 'gray',
  checking: 'gray',
  new: 'blue',
  similar: 'yellow',
  duplicate: 'gray',
  unsupported: 'orange',
  error: 'red',
  uploading: 'gray',
  saved: 'green',
  skipped: 'gray',
};

const MB = 1024 * 1024;

function isFitFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.fit');
}

/**
 * Turns dropped files into list items: FIT files as they are, ZIP archives (e.g. Garmin
 * Connect's "export original") unpacked in the worker into their FIT files.
 */
async function expandDropped(files: File[]): Promise<ImportItem[]> {
  const items: ImportItem[] = [];
  for (const file of files) {
    if (isFitFile(file)) {
      items.push(file.size > FIT_MAX_FILE_BYTES ? failedItem(file, 'too_large') : newItem(file));
      continue;
    }
    if (!isZipName(file.name)) continue;
    try {
      const unzipped = await unzipInWorker(file);
      if (!unzipped.ok) {
        items.push(failedItem(file, unzipped.error));
        continue;
      }
      for (const entry of unzipped.files) {
        const bytes = entry.bytes as Uint8Array<ArrayBuffer>;
        items.push(newItem(new File([bytes], entry.name), file.name));
      }
      for (const name of unzipped.tooLarge) {
        items.push(failedItem(new File([], name), 'too_large', file.name));
      }
    } catch {
      items.push(failedItem(file, 'worker_failed'));
    }
  }
  return items;
}

/** Extra information shown next to the status in the file list. */
function statusDetail(item: ImportItem): ReactNode {
  if (item.status === 'error' && item.error) {
    return t(f.errors[item.error], { size: FIT_MAX_FILE_BYTES / MB });
  }
  if (item.status === 'unsupported') return t(f.unsupportedSport, { sport: item.fitSport ?? '?' });
  if (item.status === 'duplicate' && item.duplicate) {
    const why = f.duplicateFields[item.duplicate.field];
    if ('sameAsFile' in item.duplicate) {
      return `${t(f.duplicateInBatch, { file: item.duplicate.sameAsFile })} (${why})`;
    }
    const { activity } = item.duplicate;
    return (
      <>
        {t(f.duplicateOf, {
          activity: `${activity.name}, ${formatLocalDate(activity.localDate)}`,
        })}{' '}
        ({why}){' '}
        <Anchor component={Link} to={`/activities/${activity.id}`} size="sm">
          {f.openActivity}
        </Anchor>
      </>
    );
  }
  if (item.status === 'saved' && item.savedId !== undefined) {
    return (
      <Anchor component={Link} to={`/activities/${item.savedId}`} size="sm">
        {f.openActivity}
      </Anchor>
    );
  }
  return null;
}

/** Import → Pliki FIT (PLAN.md 6.2). */
export function FitImport() {
  const queryClient = useQueryClient();
  const itemsRef = useRef<ImportItem[]>([]);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, ReviewErrors>>({});
  const [approvingAll, setApprovingAll] = useState(false);

  // Async steps (parsing, checks, uploads) read and write the latest list through the ref.
  const commit = (next: ImportItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const patchItem = (key: string, change: (item: ImportItem) => ImportItem) =>
    commit(itemsRef.current.map((item) => (item.key === key ? change(item) : item)));

  const addFiles = async (files: File[]) => {
    const added = await expandDropped(files);
    if (added.length === 0) return;
    commit([...itemsRef.current, ...added]);

    for (const item of added.filter((i) => i.status === 'parsing')) {
      try {
        const result = await parseFitInWorker(item.file);
        patchItem(item.key, (current) => applyParseResult(current, result));
      } catch {
        patchItem(item.key, (current) => ({ ...current, status: 'error', error: 'worker_failed' }));
      }
    }
    commit(markBatchDuplicates(itemsRef.current));

    const addedKeys = new Set(added.map((item) => item.key));
    const toCheck = itemsRef.current.filter(
      (item) => addedKeys.has(item.key) && item.status === 'checking',
    );
    if (toCheck.length === 0) return;
    try {
      const results = await checkImport(toCheck.map((item) => toCheckItem(item)!));
      for (const result of results) {
        patchItem(result.key, (current) => applyCheckResult(current, result));
      }
    } catch {
      for (const item of toCheck) {
        patchItem(item.key, (current) => ({ ...current, status: 'error', error: 'check_failed' }));
      }
    }
  };

  const onReject = (rejections: FileRejection[]) =>
    notifications.show({
      color: 'yellow',
      message: t(f.dropRejected, {
        count: rejections.length,
        fitSize: FIT_MAX_FILE_BYTES / MB,
        zipSize: ZIP_MAX_FILE_BYTES / MB,
      }),
    });

  const changeValues = (key: string, values: Partial<ReviewValues>) => {
    patchItem(key, (item) => ({ ...item, values: { ...item.values!, ...values } }));
    setErrors((current) => ({ ...current, [key]: {} }));
  };

  /** Uploads one approved file; returns once it is saved or has failed. */
  const approve = async (key: string) => {
    const item = itemsRef.current.find((i) => i.key === key);
    if (!item?.values || !item.activity) return;
    const meta = toMeta(item.values, item.status === 'similar');
    if (!meta.ok) {
      setErrors((current) => ({ ...current, [key]: meta.errors }));
      setSelectedKey(key);
      return;
    }
    const previousStatus = item.status;
    patchItem(key, (current) => ({ ...current, status: 'uploading', uploadError: undefined }));
    try {
      const saved = await uploadFit(item.file, meta.meta);
      patchItem(key, (current) => ({ ...current, status: 'saved', savedId: saved.id }));
      notifications.show({ color: 'green', message: t(f.review.saved, { name: saved.name }) });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const conflict = error.body as DuplicateConflict;
        patchItem(key, (current) =>
          conflict.code === 'duplicate'
            ? {
                ...current,
                status: 'duplicate',
                duplicate: { field: conflict.field, activity: conflict.activity },
              }
            : {
                ...current,
                status: 'similar',
                similar: conflict.similar,
                values: { ...current.values!, confirmSimilar: false },
              },
        );
        return;
      }
      const issues =
        error instanceof ApiError && error.status === 400
          ? ((error.body as { issues?: ValidationIssue[] } | null)?.issues ?? [])
          : [];
      if (issues.length > 0) {
        // E.g. the chosen event was deleted meanwhile: the item stays in the review.
        patchItem(key, (current) => ({ ...current, status: previousStatus }));
        setErrors((current) => ({
          ...current,
          [key]: Object.fromEntries(issues.map((i) => [reviewField(i.path[0]), i.code])),
        }));
        setSelectedKey(key);
        return;
      }
      if (error instanceof ApiError && error.status === 422) {
        const code = (error.body as { code?: FitErrorCode } | null)?.code ?? 'corrupt';
        patchItem(key, (current) => ({ ...current, status: 'error', error: code }));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      patchItem(key, (current) => ({
        ...current,
        status: previousStatus,
        uploadError: t(f.review.saveFailed, { file: current.file.name, error: message }),
      }));
      setSelectedKey(key);
    }
  };

  const approveAll = async () => {
    setApprovingAll(true);
    try {
      for (const item of approvableWithoutReview(itemsRef.current)) await approve(item.key);
    } finally {
      setApprovingAll(false);
    }
  };

  const skip = (key: string) => patchItem(key, (item) => ({ ...item, status: 'skipped' }));

  const clear = () => {
    commit([]);
    setErrors({});
    setSelectedKey(null);
  };

  const queue = reviewQueue(items);
  const current =
    items.find(
      (item) => item.key === selectedKey && (item.status === 'uploading' || queue.includes(item)),
    ) ?? queue[0];
  const reviewed = items.filter((i) => ['saved', 'skipped', 'uploading'].includes(i.status));
  const busy = isBusy(items);
  const approvable = approvableWithoutReview(items);
  const summary = summarize(items);
  const done = items.length > 0 && queue.length === 0 && !busy;

  return (
    <Stack>
      <Dropzone
        onDrop={(files) => void addFiles(files)}
        onReject={onReject}
        maxSize={ZIP_MAX_FILE_BYTES}
        accept={{
          'application/octet-stream': ['.fit', '.zip'],
          'application/vnd.ant.fit': ['.fit'],
          'application/zip': ['.zip'],
          'application/x-zip-compressed': ['.zip'],
        }}
        multiple
      >
        <Stack align="center" gap={4} py="lg" style={{ pointerEvents: 'none' }}>
          <Text size="lg" fw={600} ta="center">
            {f.dropTitle}
          </Text>
          <Text size="sm" c="dimmed" ta="center">
            {f.dropHint}
          </Text>
        </Stack>
      </Dropzone>

      {items.length > 0 && (
        <Stack gap="xs">
          <Group justify="space-between">
            <Title order={4}>{f.files}</Title>
            <Button variant="subtle" size="compact-sm" onClick={clear} disabled={busy}>
              {f.clear}
            </Button>
          </Group>
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing={4} fz="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{f.columns.file}</Table.Th>
                  <Table.Th>{f.columns.date}</Table.Th>
                  <Table.Th>{f.columns.distance}</Table.Th>
                  <Table.Th>{f.columns.sport}</Table.Th>
                  <Table.Th>{f.columns.status}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((item) => {
                  const reviewable = queue.includes(item);
                  return (
                    <Table.Tr
                      key={item.key}
                      onClick={reviewable ? () => setSelectedKey(item.key) : undefined}
                      style={{ cursor: reviewable ? 'pointer' : undefined }}
                      bg={item === current ? 'var(--mantine-color-blue-light)' : undefined}
                    >
                      <Table.Td>
                        {item.file.name}
                        {item.archiveName && (
                          <Text size="xs" c="dimmed">
                            {t(f.fromArchive, { archive: item.archiveName })}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {item.activity ? formatLocalDate(item.activity.localDate) : ''}
                      </Table.Td>
                      <Table.Td>
                        {item.activity ? formatDistance(item.activity.distanceM) : ''}
                      </Table.Td>
                      <Table.Td>{item.values ? pl.sports[item.values.sport] : ''}</Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          {['parsing', 'checking', 'uploading'].includes(item.status) && (
                            <Loader size={12} />
                          )}
                          <Badge color={STATUS_COLORS[item.status]} variant="light">
                            {f.status[item.status]}
                          </Badge>
                          <Text size="sm" c="dimmed">
                            {statusDetail(item)}
                          </Text>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      )}

      {current && (
        <Stack gap="xs">
          {approvable.length > 1 && (
            <Group justify="flex-end" gap="xs">
              {approvable.length < queue.length && (
                <Text size="xs" c="dimmed">
                  {f.review.approveAllHint}
                </Text>
              )}
              <Button
                variant="light"
                onClick={() => void approveAll()}
                loading={approvingAll}
                disabled={busy && !approvingAll}
              >
                {t(f.review.approveAll, { count: approvable.length })}
              </Button>
            </Group>
          )}
          <FitReview
            key={current.key}
            item={current}
            position={reviewed.filter((item) => item !== current).length + 1}
            total={reviewed.length + queue.length}
            errors={errors[current.key] ?? {}}
            saving={current.status === 'uploading'}
            onChange={(values) => changeValues(current.key, values)}
            onApprove={() => void approve(current.key)}
            onSkip={() => skip(current.key)}
          />
        </Stack>
      )}

      {done && (
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Title order={4}>{f.summary.title}</Title>
            <SimpleGrid cols={{ base: 2, sm: 5 }}>
              {(['saved', 'skipped', 'duplicate', 'unsupported', 'error'] as const).map((key) => (
                <div key={key}>
                  <Text size="xs" c="dimmed">
                    {f.summary[key]}
                  </Text>
                  <Text fw={700} size="xl">
                    {summary[key]}
                  </Text>
                </div>
              ))}
            </SimpleGrid>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
