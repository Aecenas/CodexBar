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
  return {
    ...initialUpdateStatus,
    currentVersion: APP_VERSION,
    latestVersion: typeof status?.latestVersion === "string" ? status.latestVersion : null,
    releaseUrl: typeof status?.releaseUrl === "string" ? status.releaseUrl : RELEASES_URL,
    updateAvailable: false,
    checking: false,
    downloading: false,
    downloadProgress: null,
    lastCheckedAt: typeof status?.lastCheckedAt === "number" ? status.lastCheckedAt : null,
    error: typeof status?.error === "string" ? status.error : null
  };
}
