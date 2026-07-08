import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { RateLimitSnapshot } from "./types.js";

interface JsonRpcMessage {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { message?: string; code?: number };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface RawRateLimitWindow {
  usedPercent?: number;
  resetsAt?: number | null;
  windowDurationMins?: number | null;
}

interface RawRateLimitSnapshot {
  limitId?: string | null;
  planType?: string | null;
  primary?: RawRateLimitWindow | null;
  secondary?: RawRateLimitWindow | null;
}

interface RawRateLimitResponse {
  rateLimits?: RawRateLimitSnapshot;
  rateLimitsByLimitId?: Record<string, RawRateLimitSnapshot>;
  rateLimitResetCredits?: { availableCount?: number };
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private stdoutBuffer = "";
  private pending = new Map<number, PendingRequest>();
  private initialized: Promise<void> | null = null;

  async readRateLimits(): Promise<RateLimitSnapshot> {
    const result = (await this.request("account/rateLimits/read", null, 20_000)) as RawRateLimitResponse;
    const raw = this.selectRateLimits(result);

    if (!raw?.primary || !raw.secondary) {
      throw new Error("Codex rate-limit payload did not include codex primary/secondary windows.");
    }

    return {
      limitId: raw.limitId ?? "codex",
      planType: raw.planType ?? null,
      fiveHour: this.normalizeWindow(raw.primary),
      week: this.normalizeWindow(raw.secondary),
      resetCredits: result.rateLimitResetCredits?.availableCount ?? null,
      fetchedAt: Date.now()
    };
  }

  private selectRateLimits(result: RawRateLimitResponse): RawRateLimitSnapshot | null | undefined {
    const snapshots = Object.values(result.rateLimitsByLimitId ?? {}).filter(
      (snapshot) => snapshot?.primary && snapshot.secondary
    );
    if (snapshots.length === 0) {
      return result.rateLimits;
    }

    const namedCodexLimits = snapshots.filter((snapshot) => snapshot.limitId?.startsWith("codex_"));
    const candidates = namedCodexLimits.length > 0 ? namedCodexLimits : snapshots;

    return candidates.reduce((best, current) => {
      const bestReset = best.secondary?.resetsAt ?? 0;
      const currentReset = current.secondary?.resetsAt ?? 0;
      if (currentReset !== bestReset) {
        return currentReset > bestReset ? current : best;
      }

      return (current.secondary?.usedPercent ?? 100) < (best.secondary?.usedPercent ?? 100) ? current : best;
    });
  }

  async listThreads(limit = 12): Promise<unknown[]> {
    const result = (await this.request(
      "thread/list",
      {
        limit,
        includeTurns: false,
        sortKey: "recency_at",
        sortDirection: "desc",
        useStateDbOnly: true
      },
      12_000
    )) as { data?: unknown[] };

    return Array.isArray(result.data) ? result.data : [];
  }

  dispose(): void {
    this.rejectPending(new Error("Codex app-server client disposed."));
    this.child?.kill();
    this.child = null;
    this.initialized = null;
  }

  private normalizeWindow(raw: RawRateLimitWindow) {
    const usedPercent = this.clampPercent(Math.round(raw.usedPercent ?? 0));
    return {
      usedPercent,
      remainingPercent: 100 - usedPercent,
      resetsAt: raw.resetsAt ?? null,
      windowDurationMins: raw.windowDurationMins ?? null
    };
  }

  private clampPercent(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(100, value));
  }

  private async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    await this.ensureInitialized();

    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params }) + "\n";

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.child?.stdin.write(message, "utf8", (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return this.initialized;
    }

    this.start();
    this.initialized = this.initialize();
    return this.initialized;
  }

  private start(): void {
    if (this.child && !this.child.killed) {
      return;
    }

    this.stdoutBuffer = "";
    this.child = spawn("cmd.exe", ["/d", "/s", "/c", "codex.cmd app-server --stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
    this.child.stderr.on("data", () => {
      // Codex app-server writes non-fatal diagnostics to stderr. The JSON-RPC
      // stream on stdout is authoritative for this app.
    });
    this.child.on("exit", () => {
      this.rejectPending(new Error("Codex app-server exited."));
      this.child = null;
      this.initialized = null;
    });
    this.child.on("error", (error) => {
      this.rejectPending(error);
      this.child = null;
      this.initialized = null;
    });
  }

  private initialize(): Promise<void> {
    const id = this.nextId++;
    const payload = {
      id,
      method: "initialize",
      params: {
        clientInfo: {
          name: "codexbar",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true
        }
      }
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex app-server initialize timed out."));
      }, 15_000);

      this.pending.set(id, {
        resolve: () => resolve(),
        reject,
        timer
      });
      this.child?.stdin.write(JSON.stringify(payload) + "\n");
    });
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      newlineIndex = this.stdoutBuffer.indexOf("\n");

      if (!line) {
        continue;
      }

      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }

    if (typeof message.id !== "number") {
      return;
    }

    const request = this.pending.get(message.id);
    if (!request) {
      return;
    }

    clearTimeout(request.timer);
    this.pending.delete(message.id);

    if (message.error) {
      request.reject(new Error(message.error.message ?? "Codex app-server returned an error."));
      return;
    }

    request.resolve(message.result);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}
