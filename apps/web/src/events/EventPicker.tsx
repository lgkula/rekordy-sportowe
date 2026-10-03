import {
  Button,
  CloseButton,
  Combobox,
  Group,
  InputBase,
  Paper,
  Stack,
  Text,
  useCombobox,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import type { Sport } from '@rekordy/core';
import { useMemo, useState } from 'react';
import { useEventSuggestions, useEvents } from '../api/events';
import { pl } from '../i18n/pl';
import { t } from '../i18n/template';
import { choiceName, NO_EVENT, pickerOptions, type EventChoice } from './eventChoice';

const p = pl.eventPicker;

/**
 * "Wydarzenie" field of a race (PLAN.md 4.3): pick an existing event of the sport or type a
 * new name ("Utwórz nowe"). Events with a name similar to the activity are suggested. After a
 * choice, when the activity is named differently, it asks whether to rename the activity
 * (`onRename`).
 */
export function EventPicker({
  sport,
  value,
  onChange,
  activityName,
  onRename,
  error,
}: {
  sport: Sport;
  value: EventChoice;
  onChange: (choice: EventChoice) => void;
  /** Name of the activity: the source of suggestions and the rename question. */
  activityName?: string;
  onRename?: (name: string) => void;
  error?: string;
}) {
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  /** Text typed since the dropdown opened; null shows the chosen event's name. */
  const [typed, setTyped] = useState<string | null>(null);
  const [askRename, setAskRename] = useState<string | null>(null);
  const [debouncedName] = useDebouncedValue(activityName ?? '', 400);

  const events = useEvents(sport);
  const suggestions = useEventSuggestions(sport, value.kind === 'none' ? debouncedName : '');
  const named = useMemo(
    () =>
      (events.data?.events ?? []).flatMap((e) =>
        e.id === null ? [] : [{ id: e.id, name: e.name }],
      ),
    [events.data],
  );
  const options = pickerOptions(named, suggestions.data ?? [], typed ?? '');
  const quickPicks = value.kind === 'none' ? options.suggested.slice(0, 3) : [];

  const choose = (choice: EventChoice) => {
    onChange(choice);
    setTyped(null);
    combobox.closeDropdown();
    const name = choiceName(choice);
    const differs = activityName !== undefined && name.trim() !== activityName.trim();
    setAskRename(onRename && choice.kind !== 'none' && differs ? name : null);
  };

  const submit = (optionValue: string) => {
    if (optionValue === 'new') {
      if (options.createName) choose({ kind: 'new', name: options.createName });
      return;
    }
    const id = Number(optionValue);
    const event = named.find((e) => e.id === id);
    if (event) choose({ kind: 'existing', id: event.id, name: event.name });
  };

  const option = (event: { id: number; name: string }) => (
    <Combobox.Option
      value={String(event.id)}
      key={event.id}
      active={value.kind === 'existing' && value.id === event.id}
    >
      {event.name}
    </Combobox.Option>
  );

  const hasOptions =
    options.suggested.length > 0 || options.others.length > 0 || options.createName !== null;

  return (
    <Stack gap={6}>
      <Combobox store={combobox} onOptionSubmit={submit}>
        <Combobox.Target>
          <InputBase
            label={p.label}
            description={value.kind === 'new' ? p.newHint : p.hint}
            placeholder={p.placeholder}
            value={typed ?? choiceName(value)}
            error={error}
            onChange={(event) => {
              setTyped(event.currentTarget.value);
              combobox.openDropdown();
              combobox.updateSelectedOptionIndex();
            }}
            onClick={() => combobox.openDropdown()}
            onFocus={() => combobox.openDropdown()}
            onBlur={() => {
              combobox.closeDropdown();
              setTyped(null);
            }}
            rightSection={
              value.kind === 'none' ? (
                <Combobox.Chevron />
              ) : (
                <CloseButton
                  size="sm"
                  aria-label={p.clear}
                  title={p.clear}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(NO_EVENT)}
                />
              )
            }
            rightSectionPointerEvents={value.kind === 'none' ? 'none' : 'all'}
          />
        </Combobox.Target>
        <Combobox.Dropdown>
          <Combobox.Options mah={280} style={{ overflowY: 'auto' }}>
            {!hasOptions && <Combobox.Empty>{p.nothing}</Combobox.Empty>}
            {options.suggested.length > 0 && (
              <Combobox.Group label={p.suggested}>{options.suggested.map(option)}</Combobox.Group>
            )}
            {options.others.length > 0 &&
              (options.suggested.length > 0 ? (
                <Combobox.Group label={p.all}>{options.others.map(option)}</Combobox.Group>
              ) : (
                options.others.map(option)
              ))}
            {options.createName !== null && (
              <Combobox.Option value="new">
                {t(p.create, { name: options.createName })}
              </Combobox.Option>
            )}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>

      {quickPicks.length > 0 && (
        <Group gap={6}>
          <Text size="xs" c="dimmed">
            {p.suggestions}:
          </Text>
          {quickPicks.map((event) => (
            <Button
              key={event.id}
              size="compact-xs"
              variant="light"
              onClick={() => choose({ kind: 'existing', id: event.id, name: event.name })}
            >
              {event.name}
            </Button>
          ))}
        </Group>
      )}

      {askRename !== null && onRename && (
        <Paper withBorder p="xs" bg="var(--mantine-primary-color-light)">
          <Group gap="xs" justify="space-between">
            <Text size="sm">{t(p.renameQuestion, { name: askRename })}</Text>
            <Group gap={6}>
              <Button
                size="compact-sm"
                onClick={() => {
                  onRename(askRename);
                  setAskRename(null);
                }}
              >
                {p.rename}
              </Button>
              <Button size="compact-sm" variant="default" onClick={() => setAskRename(null)}>
                {p.keep}
              </Button>
            </Group>
          </Group>
        </Paper>
      )}
    </Stack>
  );
}
