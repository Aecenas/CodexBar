import type { ActivityState, QuotaStatus } from "../types";

interface StatusIconProps {
  status: QuotaStatus;
  activity: ActivityState;
}

export function StatusIcon({ status, activity }: StatusIconProps) {
  return (
    <div className={`status-orb ${status} ${activity}`} aria-label={`Codex status ${status}, ${activity}`}>
      <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
        <path d="M13.7 2.6 5.5 13.1c-.42.54-.04 1.33.64 1.33h5.08l-1.03 6.43c-.14.86.96 1.32 1.47.61l7.86-10.94c.39-.54 0-1.29-.67-1.29h-4.82l1.08-5.98c.16-.85-.88-1.37-1.41-.66Z" />
      </svg>
    </div>
  );
}
