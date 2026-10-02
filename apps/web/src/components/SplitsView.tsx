import { BarChart } from '@mantine/charts';
import { Stack, Table, Text } from '@mantine/core';
import { formatDistance, formatDuration, formatPace, type Split } from '@rekordy/core';
import { pl } from '../i18n/pl';

function splitPace(split: Split): number {
  return split.durationS / (split.distanceM / 1000);
}

function splitLabel(split: Split): string {
  return split.partial ? formatDistance(split.distanceM, { unit: false }) : String(split.km);
}

/**
 * Per-km splits: a table plus a small bar chart of the pace (PLAN.md 4.3). Read-only; used by
 * the import review and the activity detail (and later the races view).
 */
export function SplitsView({ splits }: { splits: readonly Split[] }) {
  const s = pl.splits;
  if (splits.length === 0) return <Text c="dimmed">{s.empty}</Text>;
  const hasElevation = splits.some((split) => split.elevationGainM != null);
  // Bars show speed (m/s), so that a faster kilometre is a taller bar; the tooltip shows the
  // pace. No Y axis: its ticks would fall on odd paces, and the table has exact values.
  const data = splits.map((split) => ({
    km: splitLabel(split),
    speed: split.distanceM / split.durationS,
  }));
  const speeds = data.map((d) => d.speed);
  // Start the axis a bit below the slowest kilometre, so that differences are visible.
  const domain = [Math.min(...speeds) * 0.85, Math.max(...speeds) * 1.03];
  const paceLabel = (speed: number) => formatPace(1000 / speed);

  return (
    <Stack gap="sm">
      <BarChart
        h={180}
        data={data}
        dataKey="km"
        series={[{ name: 'speed', label: s.chartPace, color: 'blue.6' }]}
        valueFormatter={(speed) => `${paceLabel(speed)} /km`}
        yAxisProps={{ domain }}
        withYAxis={false}
        gridAxis="none"
      />
      <Table.ScrollContainer minWidth={hasElevation ? 420 : 340}>
        <Table striped verticalSpacing={4} fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{s.km}</Table.Th>
              <Table.Th>{s.distance}</Table.Th>
              <Table.Th>{s.duration}</Table.Th>
              <Table.Th>{s.pace}</Table.Th>
              {hasElevation && <Table.Th>{s.elevationGain}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {splits.map((split) => (
              <Table.Tr key={split.km}>
                <Table.Td>
                  {split.km}
                  {split.partial && (
                    <Text span size="xs" c="dimmed">
                      {' '}
                      ({s.partial})
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{formatDistance(split.distanceM)}</Table.Td>
                <Table.Td>{formatDuration(split.durationS)}</Table.Td>
                <Table.Td>{formatPace(splitPace(split), { unit: true })}</Table.Td>
                {hasElevation && (
                  <Table.Td>
                    {split.elevationGainM == null ? '—' : `${split.elevationGainM} m`}
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
