export const CATEGORIES = [
  ["pribeh", "Sdílej svůj příběh"],
  ["potencial", "Nabídni svůj potenciál (hledám práci)"],
  ["prace", "Nabídni práci"],
  ["terapie", "Nabídni terapii"],
  ["pravni", "Nabídni právní pomoc"],
  ["pridej_se", "Nabídni pomoc – přidej se k nám"],
  ["vyrobky", "Nabídni své výrobky a služby"],
  ["potrebuji_pomoc", "Potřebuji pomoc"],
];
export const STATUSES = {
  new: "Nový",
  in_progress: "V řešení",
  contacted: "Kontaktováno",
  published: "Zveřejněno",
  archived: "Archiv",
};
export const URGENCIES = {
  low: "Nízká",
  medium: "Střední",
  high: "Vysoká",
  acute: "Akutní",
};
export const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function toCsv(rows, includeText = false) {
  const cols = [
    "entity",
    "id",
    "created_at",
    "full_name",
    "email",
    "status",
    "category",
    "urgency",
    "consent_publish",
    "age_confirmed",
  ];
  if (includeText) cols.push("body", "transcript");
  return (
    "\uFEFF" +
    [
      cols.join(";"),
      ...rows.map((r) => cols.map((k) => csvCell(r[k])).join(";")),
    ].join("\r\n")
  );
}
export function retentionAt(row) {
  const d = new Date(
    row.entity === "help_offers"
      ? row.last_contact_at || row.created_at
      : row.created_at,
  );
  d.setUTCMonth(d.getUTCMonth() + (row.entity === "help_offers" ? 24 : 12));
  return row.entity === "stories" && row.status === "published"
    ? null
    : d.toISOString();
}
