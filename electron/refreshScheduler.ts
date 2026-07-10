import type { BrowserWindow } from "electron";
import type { CodexActivityDetector } from "./codexActivityDetector.js";
import type { CodexAppServerClient } from "./codexAppServerClient.js";
import type { ActivityState, AppDiagnostics, PollingSettings, QuotaUpdatePayload, RateLimitSnapshot } from "./types.js";
import { DEFAULT_POLLING_SETTINGS, normalizePollingSettings } from "./pollingSettings.js";
import { TokenUsageReader, type TokenUsageSnapshot } from "./tokenUsageReader.js";

export class RefreshScheduler {
  private activity: ActivityState = "unknown";
  private lastSnapshot: RateLimitSnapshot | null = null;
  private lastTokenUsage: TokenUsageSnapshot | null = null;
  private lastStatus: QuotaUpdatePayload["status"] = "loading";
  private lastQuotaError: string | null = null;
  private lastQuotaReadAt = 0;
  private lastQuotaAttemptAt = 0;
  private consecutiveQuotaFailures = 0;
  private activityTimer: NodeJS.Timeout | null = null;
  private quotaTimer: NodeJS.Timeout | null = null;
  private pollingSettings = DEFAULT_POLLING_SETTINGS;
  private running = false;
  private quotaReadInFlight = false;
  private tokenUsageReadInFlight = false;

  constructor(
    private readonly window: BrowserWindow,
    private readonly rateLimitClient: CodexAppServerClient,
    private readonly activityDetector: CodexActivityDetector,
    private readonly tokenUsageReader = new TokenUsageReader()
  ) {}

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.push({
      fiveHourRemaining: null,
      weekRemaining: null,
      fiveHourResetAt: null,
      weekResetAt: null,
      fiveHourTokensUsed: null,
      weekTokensUsed: null,
      status: "loading",
      activity: this.activity,
      fetchedAt: null
    });
    void this.probeActivity();
    void this.readQuota();
    void this.refreshTokenUsage();
  }

  stop(): void {
    this.running = false;
    if (this.activityTimer) {
      clearTimeout(this.activityTimer);
    }
    if (this.quotaTimer) {
      clearTimeout(this.quotaTimer);
    }
    this.activityTimer = null;
    this.quotaTimer = null;
    this.activityDetector.dispose();
  }

  getPollingSettings(): PollingSettings {
    return this.pollingSettings;
  }

  updatePollingSettings(settings: Partial<PollingSettings>): PollingSettings {
    this.pollingSettings = normalizePollingSettings(settings);
    if (this.running) {
      this.scheduleNextActivityProbe();
      this.scheduleNextQuotaRead();
    }

    return this.pollingSettings;
  }

  private async probeActivity(): Promise<void> {
    if (!this.running) {
      return;
    }

    const nextActivity = await this.activityDetector.getActivity();
    if (!this.running) {
      return;
    }

    const activityChanged = nextActivity !== this.activity;
    this.activity = nextActivity;
    if (activityChanged) {
      this.pushCurrentState();
    }
    this.scheduleNextQuotaRead();
    this.scheduleNextActivityProbe();
  }

  private async readQuota(): Promise<void> {
    if (!this.running || this.quotaReadInFlight) {
      return;
    }

    this.quotaReadInFlight = true;
    try {
      const snapshot = await this.rateLimitClient.readRateLimits();
      if (!this.running) {
        return;
      }

      this.lastSnapshot = snapshot;
      this.lastQuotaReadAt = Date.now();
      this.lastStatus = "ready";
      this.lastQuotaError = null;
      this.consecutiveQuotaFailures = 0;
      this.push(this.toPayload(snapshot, "ready", this.lastTokenUsage));
    } catch (error) {
      if (!this.running) {
        return;
      }

      this.consecutiveQuotaFailures += 1;
      this.lastStatus = this.lastSnapshot ? "stale" : "error";
      this.lastQuotaError = error instanceof Error ? error.message : "Failed to read Codex quota.";
      this.push({
        ...(this.lastSnapshot
          ? this.toPayload(this.lastSnapshot, "stale", this.lastTokenUsage)
          : {
              fiveHourRemaining: null,
              weekRemaining: null,
              fiveHourResetAt: null,
              weekResetAt: null,
              fiveHourTokensUsed: this.lastTokenUsage?.fiveHourTokensUsed ?? null,
              weekTokensUsed: this.lastTokenUsage?.weekTokensUsed ?? null,
              status: "error" as const,
              activity: this.activity,
              fetchedAt: null
            }),
        error: this.lastQuotaError
      });
    } finally {
      this.quotaReadInFlight = false;
      this.lastQuotaAttemptAt = Date.now();
      if (this.running) {
        this.scheduleNextQuotaRead();
        void this.refreshTokenUsage();
      }
    }
  }

  private scheduleNextQuotaRead(): void {
    if (!this.running) {
      return;
    }

    if (this.quotaTimer) {
      clearTimeout(this.quotaTimer);
    }

    if (this.quotaReadInFlight) {
      this.quotaTimer = null;
      return;
    }

    const intervalSeconds =
      this.activity === "busy" ? this.pollingSettings.busyQuotaSeconds : this.pollingSettings.idleQuotaSeconds;
    const normalInterval = intervalSeconds * 1000;
    const retryInterval =
      this.consecutiveQuotaFailures === 0
        ? normalInterval
        : Math.min(normalInterval, 5 * 60 * 1000, 5_000 * 2 ** Math.min(6, this.consecutiveQuotaFailures - 1));
    const elapsed = Date.now() - this.lastQuotaAttemptAt;
    const delay = this.lastQuotaAttemptAt === 0 ? 0 : Math.max(1_000, retryInterval - elapsed);

    this.quotaTimer = setTimeout(() => void this.readQuota(), delay);
  }

  private scheduleNextActivityProbe(): void {
    if (!this.running) {
      return;
    }

    if (this.activityTimer) {
      clearTimeout(this.activityTimer);
    }

    this.activityTimer = setTimeout(
      () => void this.probeActivity(),
      this.pollingSettings.activityCheckSeconds * 1000
    );
  }

  private async refreshTokenUsage(): Promise<void> {
    if (!this.running || this.tokenUsageReadInFlight) {
      return;
    }

    this.tokenUsageReadInFlight = true;
    try {
      this.lastTokenUsage = await this.tokenUsageReader.readUsage();
      if (this.running) {
        this.pushCurrentState();
      }
    } catch {
      // Token usage is advisory; quota percentages should not depend on local JSONL parsing.
    } finally {
      this.tokenUsageReadInFlight = false;
    }
  }

  private toPayload(
    snapshot: RateLimitSnapshot,
    status: QuotaUpdatePayload["status"],
    tokenUsage: TokenUsageSnapshot | null
  ): QuotaUpdatePayload {
    return {
      fiveHourRemaining: snapshot.fiveHour.remainingPercent,
      weekRemaining: snapshot.week?.remainingPercent ?? null,
      fiveHourResetAt: snapshot.fiveHour.resetsAt,
      weekResetAt: snapshot.week?.resetsAt ?? null,
      fiveHourTokensUsed: tokenUsage?.fiveHourTokensUsed ?? null,
      weekTokensUsed: tokenUsage?.weekTokensUsed ?? null,
      status,
      activity: this.activity,
      fetchedAt: snapshot.fetchedAt
    };
  }

  private push(payload: QuotaUpdatePayload): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send("quota:update", payload);
    }
  }

  private pushCurrentState(): void {
    if (this.lastSnapshot) {
      this.push(this.toPayload(this.lastSnapshot, this.lastStatus, this.lastTokenUsage));
      return;
    }

    this.push({
      fiveHourRemaining: null,
      weekRemaining: null,
      fiveHourResetAt: null,
      weekResetAt: null,
      fiveHourTokensUsed: this.lastTokenUsage?.fiveHourTokensUsed ?? null,
      weekTokensUsed: this.lastTokenUsage?.weekTokensUsed ?? null,
      status: this.lastStatus,
      activity: this.activity,
      fetchedAt: null,
      error: this.lastQuotaError ?? undefined
    });
  }

  getDiagnostics(): AppDiagnostics {
    return {
      activity: this.activity,
      quotaStatus: this.lastStatus,
      lastQuotaReadAt: this.lastQuotaReadAt === 0 ? null : this.lastQuotaReadAt,
      lastQuotaError: this.lastQuotaError,
      lastQuotaFetchedAt: this.lastSnapshot?.fetchedAt ?? null,
      activityDetector: this.activityDetector.getDiagnostics(),
      tokenUsage: this.tokenUsageReader.getDiagnostics()
    };
  }
}
