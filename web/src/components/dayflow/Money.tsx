/** Displays a money string sent by the engine. Never does arithmetic on money. */
const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

export function formatMoney(value: string | null | undefined): string {
  if (value == null || value === "") return "Not computed";
  const n = Number(value);
  return Number.isFinite(n) ? fmt.format(n) : value;
}

export function Money({ value, className }: { value: string | null | undefined; className?: string }) {
  return <span className={className ?? "tabular-nums"}>{formatMoney(value)}</span>;
}
