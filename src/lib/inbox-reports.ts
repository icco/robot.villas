import type { InboxRequestReport } from "@fedify/fedify";

/** Process-local and bounded: a fixed set of keys, never values from the request. */
const counts = new Map<string, number>();
const startedAt = new Date();

export function inboxReportKey(report: InboxRequestReport): string {
  const outcome = report.outcome.type === "exception"
    ? `exception:${report.outcome.stage}`
    : "reason" in report.outcome
      ? `${report.outcome.disposition}:${report.outcome.reason}`
      : report.outcome.disposition;
  const auth = report.authentication.status === "rejected"
    ? `rejected:${report.authentication.reason.type}`
    : report.authentication.status;
  return `${auth} ${outcome}`;
}

export function recordInboxReport(report: InboxRequestReport): string {
  const key = inboxReportKey(report);
  counts.set(key, (counts.get(key) ?? 0) + 1);
  return key;
}

export function getInboxReportSummary(): { since: Date; rows: Array<{ key: string; count: number }> } {
  return {
    since: startedAt,
    rows: [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
  };
}
