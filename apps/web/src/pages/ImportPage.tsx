import { Stack, Tabs, Text, Title } from '@mantine/core';
import { FitImport } from '../import/FitImport';
import { pl } from '../i18n/pl';

/** `/import` (editor only): FIT files now; bulk export and the agent inbox come later. */
export function ImportPage() {
  const tabs = pl.import.tabs;
  return (
    <Stack>
      <Title order={2}>{pl.pages.import.title}</Title>
      <Tabs defaultValue="fit" keepMounted>
        <Tabs.List>
          <Tabs.Tab value="fit">{tabs.fit}</Tabs.Tab>
          <Tabs.Tab value="bulk">{tabs.bulk}</Tabs.Tab>
          <Tabs.Tab value="inbox">{tabs.inbox}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="fit" pt="md">
          <FitImport />
        </Tabs.Panel>
        <Tabs.Panel value="bulk" pt="md">
          <Text c="dimmed">{pl.import.later}</Text>
        </Tabs.Panel>
        <Tabs.Panel value="inbox" pt="md">
          <Text c="dimmed">{pl.import.later}</Text>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
