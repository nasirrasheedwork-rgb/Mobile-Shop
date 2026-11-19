import type { Entry, Model } from "./schema";

export const pkr = (amount: number) => "Rs " + new Intl.NumberFormat("en-IN").format(amount);
export const showDate = (value?: string | null) => value?.slice(0, 10).split("-").reverse().join("-") || "—";
export const today = (date = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);
export function shiftDay(day: string, count: number) {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export const title = (model?: Model) => model ? [model.brand, model.model, model.storage].filter(Boolean).join(" ") : "Unknown model";
export const label = (value: string | null) => value?.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()) ?? "—";
export const signed = (entry: Entry) => entry.type === "IN" ? entry.amount : -entry.amount;
export function bankTotals(entries: Entry[]) {
  const received = entries.filter(e => e.status === "RECEIVED").reduce((sum, e) => sum + signed(e), 0);
  const pending = entries.filter(e => e.status === "PENDING").reduce((sum, e) => sum + signed(e), 0);
  return { received, pending, total: received + pending };
}
export function matches(query: string, ...parts: (string | undefined)[]) {
  const value = parts.join(" ").toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every(term => value.includes(term));
}
