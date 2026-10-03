import { Text, Tooltip } from '@mantine/core';
import { useState, type ReactNode } from 'react';

/**
 * Inline text with a tooltip that also opens on a tap, so it works on a phone: Mantine's own
 * events ignore a focus from touch. A mouse hover, keyboard focus or tap opens it; leaving
 * with the mouse or blurring (tapping elsewhere) closes it. Hover uses pointer events of the
 * mouse only, because a tap also fires emulated mouse enter/leave events that would close it.
 */
export function TapTooltip({ label, children }: { label: string; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  const open = () => setOpened(true);
  const close = () => setOpened(false);
  return (
    <Tooltip label={label} opened={opened} multiline maw={260}>
      <Text
        span
        c="dimmed"
        fz="sm"
        tabIndex={0}
        style={{ cursor: 'help', whiteSpace: 'nowrap' }}
        onPointerEnter={(event) => event.pointerType === 'mouse' && open()}
        onPointerLeave={(event) => event.pointerType === 'mouse' && close()}
        onFocus={open}
        onBlur={close}
        onClick={open}
      >
        {children}
      </Text>
    </Tooltip>
  );
}
