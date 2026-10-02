import { Badge, Tooltip } from '@mantine/core';
import { useHealth } from '../api/health';
import { pl } from '../i18n/pl';

export function ApiStatus() {
  const { data, isPending, isError } = useHealth();

  if (isPending) {
    return (
      <Badge variant="light" color="gray">
        {pl.apiStatus.checking}
      </Badge>
    );
  }
  if (isError) {
    return (
      <Badge variant="light" color="red">
        {pl.apiStatus.offline}
      </Badge>
    );
  }
  const ok = data.status === 'ok';
  return (
    <Tooltip label={`v${data.version}`}>
      <Badge variant="light" color={ok ? 'green' : 'orange'}>
        {ok ? pl.apiStatus.ok : pl.apiStatus.degraded}
      </Badge>
    </Tooltip>
  );
}
