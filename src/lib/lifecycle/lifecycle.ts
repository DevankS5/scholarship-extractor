import { dateDiffDays, daysBetween, todayIso } from "../util";

export type Lifecycle = "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "UPCOMING" | "CLOSED" | "NO_LONGER_VERIFIABLE" | "REMOVED" | "UNKNOWN";

export interface LifecycleInput {
  closingDate: string | null;
  openingDate: string | null;
  signals: { explicitClosed?: boolean; explicitOpen?: boolean; explicitDiscontinued?: boolean };
  now: Date;
  warningDays: number;
}

/** Date/evidence-driven lifecycle. A reachable page alone never yields ACTIVE. */
export function computeLifecycle(i: LifecycleInput): { status: Lifecycle; reason: string } {
  const today = todayIso(i.now);
  if (i.signals.explicitDiscontinued) return { status: "REMOVED", reason: "The official source explicitly states the opportunity is discontinued/withdrawn." };
  if (i.closingDate) {
    const left = dateDiffDays(today, i.closingDate);
    if (left < 0) return { status: "EXPIRED", reason: `Supported closing date ${i.closingDate} has passed (as of ${today}).` };
    if (i.signals.explicitClosed) return { status: "CLOSED", reason: "The official source says applications are closed." };
    if (i.openingDate && dateDiffDays(today, i.openingDate) > 0) return { status: "UPCOMING", reason: `Applications open on ${i.openingDate}.` };
    if (left <= i.warningDays) return { status: "EXPIRING_SOON", reason: `Closing date ${i.closingDate} is ${left} day(s) away.` };
    return { status: "ACTIVE", reason: `Closing date ${i.closingDate} is in the future.` };
  }
  if (i.signals.explicitClosed) return { status: "CLOSED", reason: "The official source says applications are closed." };
  if (i.openingDate && dateDiffDays(today, i.openingDate) > 0) return { status: "UPCOMING", reason: `Applications open on ${i.openingDate}.` };
  if (i.signals.explicitOpen) return { status: "ACTIVE", reason: "The official source states applications are open / accepted on a rolling basis." };
  return { status: "UNKNOWN", reason: "No supported deadline or open-state wording on the source." };
}

export interface FailureInput {
  previous: Lifecycle;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  now: Date;
  minFailures: number;
  graceDays: number;
}

/**
 * A failed fetch NEVER implies removal. Only repeated failures beyond a grace period downgrade to
 * NO_LONGER_VERIFIABLE; a supported past deadline (EXPIRED) and explicit REMOVED/CLOSED are kept.
 */
export function lifecycleAfterFailure(i: FailureInput): { status: Lifecycle; changed: boolean; reason: string } {
  const keep: Lifecycle[] = ["EXPIRED", "REMOVED", "CLOSED", "NO_LONGER_VERIFIABLE"];
  const sinceSuccess = i.lastSuccessAt ? daysBetween(i.lastSuccessAt, i.now) : Infinity;
  if (keep.includes(i.previous)) return { status: i.previous, changed: false, reason: "Lifecycle retained after failed observation." };
  if (i.consecutiveFailures >= i.minFailures && sinceSuccess >= i.graceDays) {
    return {
      status: "NO_LONGER_VERIFIABLE",
      changed: true,
      reason: `${i.consecutiveFailures} consecutive failed observations over ${Number.isFinite(sinceSuccess) ? sinceSuccess : "∞"} day(s) since the last success (grace ${i.graceDays}d).`,
    };
  }
  return { status: i.previous, changed: false, reason: `Failed observation ${i.consecutiveFailures}/${i.minFailures}; within grace period — lifecycle unchanged.` };
}

export function nextCheckAt(now: Date, closingDate: string | null, recheckDefault: number, recheckNear: number, warningDays: number): Date {
  let days = recheckDefault;
  if (closingDate) {
    const left = dateDiffDays(todayIso(now), closingDate);
    if (left >= 0 && left <= warningDays) days = recheckNear;
  }
  return new Date(now.getTime() + days * 86_400_000);
}
