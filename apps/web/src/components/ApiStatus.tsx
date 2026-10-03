import { Badge, ColorSwatch, Tooltip, type MantineColor } from '@mantine/core';
import { useHealth } from '../api/health';
import { pl } from '../i18n/pl';

export function ApiStatus() {
  const { data, isPending, isError } = useHealth();

  let color: MantineColor;
  let label: string;
  if (isPending) {
    color = 'gray';
    label = pl.apiStatus.checking;
  } else if (isError) {
    color = 'red';
    label = pl.apiStatus.offline;
  } else {
    const ok = data.status === 'ok';
    color = ok ? 'green' : 'orange';
    label = ok ? pl.apiStatus.ok : pl.apiStatus.degraded;
  }

  return (
    <Tooltip label={data ? `${label} · v${data.version}` : label}>
      <div>
        <Badge variant="light" color={color} visibleFrom="sm">
          {label}
        </Badge>
        {/* On a phone only a dot, so the role badge fits in the header. */}
        <ColorSwatch
          hiddenFrom="sm"
          size={12}
          color={`var(--mantine-color-${color}-6)`}
          withShadow={false}
          role="img"
          aria-label={label}
        />
      </div>
    </Tooltip>
  );
}
