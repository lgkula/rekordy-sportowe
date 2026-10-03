import { Table, Text } from '@mantine/core';
import {
  formatDistance,
  formatDuration,
  formatPace,
  type DistanceKey,
  type EffortValues,
} from '@rekordy/core';
import { pl } from '../i18n/pl';
import { t } from '../i18n/template';
import { TapTooltip } from './TapTooltip';

type EffortRow = Pick<
  EffortValues,
  'distanceKey' | 'durationS' | 'paceSPerKm' | 'isTolerance' | 'actualDistanceM'
>;

/**
 * Results on record distances (computed preview or stored efforts). Tolerance results show
 * the pace only, marked with an asterisk; the tooltip gives the actual distance (D2).
 */
export function EffortsTable({ efforts }: { efforts: readonly EffortRow[] }) {
  const e = pl.efforts;
  if (efforts.length === 0) return <Text c="dimmed">{e.empty}</Text>;
  return (
    <Table verticalSpacing={4} fz="sm" maw={420}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{e.distance}</Table.Th>
          <Table.Th>{e.pace}</Table.Th>
          <Table.Th>{e.duration}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {efforts.map((effort) => (
          <Table.Tr key={effort.distanceKey}>
            <Table.Td>{pl.distances[effort.distanceKey as DistanceKey]}</Table.Td>
            <Table.Td>
              {effort.isTolerance ? (
                <TapTooltip
                  label={t(e.tolerance, { distance: formatDistance(effort.actualDistanceM) })}
                >
                  {formatPace(effort.paceSPerKm, { unit: true })} *
                </TapTooltip>
              ) : (
                formatPace(effort.paceSPerKm, { unit: true })
              )}
            </Table.Td>
            <Table.Td>{effort.isTolerance ? '—' : formatDuration(effort.durationS)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
