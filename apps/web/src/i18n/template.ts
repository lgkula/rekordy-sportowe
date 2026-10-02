/** Fills `{name}` placeholders in a UI string, e.g. `t(pl.activities.total, { count: 3 })`. */
export function t(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
