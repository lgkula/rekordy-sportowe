import { Stack, Text, Title } from '@mantine/core';
import { pl } from '../i18n/pl';

/** Temporary page body until the feature is implemented in a later part. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <Stack gap="xs">
      <Title order={2}>{title}</Title>
      <Text c="dimmed">{pl.placeholder}</Text>
    </Stack>
  );
}
