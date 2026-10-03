/** Fills `{name}` placeholders in a UI string, e.g. `t(pl.activities.total, { count: 3 })`. */
export function t(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Polish plural form for `n`: `[one, few, many]`, e.g. 1 edycja, 3 edycje, 5 edycji. */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const [one, few, many] = forms;
  if (n === 1) return one;
  const lastDigit = n % 10;
  const lastTwo = n % 100;
  return lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
}
