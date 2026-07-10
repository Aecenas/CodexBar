import type { UpdateStatus } from "./types";
import { APP_VERSION, RELEASES_URL } from "./version";

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const initialUpdateStatus: UpdateStatus = {
  currentVersion: APP_VERSION,
  latestVersion: null,
  releaseUrl: RELEASES_URL,
  updateAvailable: false,
  checking: false,
  downloading: false,
  downloadProgress: null,
  lastCheckedAt: null,
  error: null
};

export function normalizeStoredUpdateStatus(status: Partial<UpdateStatus> | null | undefined): UpdateStatus {
  const latestVersion = typeof status?.latestVersion === "string" ? status.latestVersion : null;
  return {
    ...initialUpdateStatus,
    currentVersion: APP_VERSION,
    latestVersion,
    releaseUrl: typeof status?.releaseUrl === "string" ? status.releaseUrl : RELEASES_URL,
    updateAvailable: latestVersion === null ? false : isNewerVersion(latestVersion, APP_VERSION),
    checking: false,
    downloading: false,
    downloadProgress: null,
    lastCheckedAt: typeof status?.lastCheckedAt === "number" ? status.lastCheckedAt : null,
    error: typeof status?.error === "string" ? status.error : null
  };
}

function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = parseVersion(latest);
  const currentParts = parseVersion(current);
  const length = Math.max(latestParts.length, currentParts.length);
  for (let index = 0; index < length; index += 1) {
    const latestPart = latestParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;
    if (latestPart !== currentPart) {
      return latestPart > currentPart;
    }
  }
  return false;
}

function parseVersion(value: string): number[] {
  return value
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter(Number.isFinite);
}
