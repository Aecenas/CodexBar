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
  private activityTimer: NodeJS.Timeout | null = null;
  private quotaTimer: NodeJS.Timeout | null = null;
  private pollingSettings = DEFAULT_POLLING_SETTINGS;
  private running = false;

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
    const activityChanged = nextActivity !== this.activity;
    this.activity = nextActivity;
    if (activityChanged) {
      this.pushCurrentState();
    }
    this.scheduleNextQuotaRead();
    this.scheduleNextActivityProbe();
  }

  private async readQuota(): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      const snapshot = await this.rateLimitClient.readRateLimits();
      const tokenUsage = await this.readTokenUsage();
      this.lastSnapshot = snapshot;
      this.lastQuotaReadAt = Date.now();
      this.lastStatus = "ready";
      this.lastQuotaError = null;
      this.push(this.toPayload(snapshot, "ready", tokenUsage));
    } catch (error) {
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
    }

    this.scheduleNextQuotaRead();
  }

  private scheduleNextQuotaRead(): void {
    if (!this.running) {
      return;
    }

    if (this.quotaTimer) {
      clearTimeout(this.quotaTimer);
    }

    const intervalSeconds =
      this.activity === "busy" ? this.pollingSettings.busyQuotaSeconds : this.pollingSettings.idleQuotaSeconds;
    const interval = intervalSeconds * 1000;
    const elapsed = Date.now() - this.lastQuotaReadAt;
    const delay = this.lastQuotaReadAt === 0 ? 0 : Math.max(1_000, interval - elapsed);

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

  private async readTokenUsage(): Promise<TokenUsageSnapshot | null> {
    try {
      this.lastTokenUsage = await this.tokenUsageReader.readUsage();
    } catch {
      // Token usage is advisory; quota percentages should not depend on local JSONL parsing.
    }

    return this.lastTokenUsage;
  }

  private toPayload(
    snapshot: RateLimitSnapshot,
    status: QuotaUpdatePayload["status"],
    tokenUsage: TokenUsageSnapshot | null
  ): QuotaUpdatePayload {
    return {
      fiveHourRemaining: snapshot.fiveHour.remainingPercent,
      weekRemaining: snapshot.week.remainingPercent,
      fiveHourResetAt: snapshot.fiveHour.resetsAt,
      weekResetAt: snapshot.week.resetsAt,
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
      fetchedAt: null
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
