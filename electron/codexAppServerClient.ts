import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
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
  private stderrBuffer = "";

  async readRateLimits(): Promise<RateLimitSnapshot> {
    const result = (await this.request("account/rateLimits/read", null, 20_000)) as RawRateLimitResponse;
    const raw = this.selectRateLimits(result);

    if (!raw?.primary) {
      throw new Error("Codex rate-limit payload did not include a primary window.");
    }

    return {
      limitId: raw.limitId ?? "codex",
      planType: raw.planType ?? null,
      fiveHour: this.normalizeWindow(raw.primary),
      week: raw.secondary ? this.normalizeWindow(raw.secondary) : null,
      resetCredits: result.rateLimitResetCredits?.availableCount ?? null,
      fetchedAt: Date.now()
    };
  }

  private selectRateLimits(result: RawRateLimitResponse): RawRateLimitSnapshot | null | undefined {
    if (result.rateLimits?.primary) {
      return result.rateLimits;
    }

    const exactCodexLimit = result.rateLimitsByLimitId?.codex;
    return exactCodexLimit?.primary ? exactCodexLimit : null;
  }

  dispose(): void {
    this.rejectPending(new Error("Codex app-server client disposed."));
    this.terminateChild();
  }

  private normalizeWindow(raw: RawRateLimitWindow) {
    if (typeof raw.usedPercent !== "number" || !Number.isFinite(raw.usedPercent)) {
      throw new Error("Codex rate-limit window did not include a valid usedPercent value.");
    }

    const usedPercent = this.clampPercent(Math.round(raw.usedPercent));
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
      void this.writeLine(message).catch((error: Error) => {
        const request = this.pending.get(id);
        if (request) {
          clearTimeout(timer);
          this.pending.delete(id);
          request.reject(error);
        }
      });
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return this.initialized;
    }

    this.start();
    const initialization = this.initialize().catch((error) => {
      this.terminateChild();
      this.initialized = null;
      throw error;
    });
    this.initialized = initialization;
    return initialization;
  }

  private start(): void {
    if (this.child && !this.child.killed) {
      return;
    }

    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    const executable = resolveCodexExecutable();
    const usesCommandWrapper = process.platform === "win32" && executable.toLowerCase().endsWith(".cmd");
    const child = spawn(
      usesCommandWrapper ? process.env.ComSpec ?? "cmd.exe" : executable,
      usesCommandWrapper ? ["/d", "/s", "/c", "codex.cmd app-server --stdio"] : ["app-server", "--stdio"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: true
      }
    );
    this.child = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-4_096);
    });
    child.stdin.on("error", (error) => this.handleChildFailure(child, error));
    child.on("exit", (code, signal) => {
      if (this.child !== child) {
        return;
      }

      const details = this.stderrBuffer.trim().split(/\r?\n/).at(-1);
      const suffix = details ? ` ${details}` : ` Exit code: ${code ?? "unknown"}, signal: ${signal ?? "none"}.`;
      this.rejectPending(new Error(`Codex app-server exited.${suffix}`));
      this.child = null;
      this.initialized = null;
    });
    child.on("error", (error) => this.handleChildFailure(child, error));
  }

  private async initialize(): Promise<void> {
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

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex app-server initialize timed out."));
      }, 15_000);

      this.pending.set(id, {
        resolve: () => resolve(),
        reject,
        timer
      });
      void this.writeLine(JSON.stringify(payload) + "\n").catch((error: Error) => {
        const request = this.pending.get(id);
        if (request) {
          clearTimeout(timer);
          this.pending.delete(id);
          request.reject(error);
        }
      });
    });

    await this.writeLine(JSON.stringify({ method: "initialized", params: {} }) + "\n");
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

  private writeLine(message: string): Promise<void> {
    const child = this.child;
    if (!child || child.killed || !child.stdin.writable) {
      return Promise.reject(new Error("Codex app-server stdin is unavailable."));
    }

    return new Promise((resolve, reject) => {
      child.stdin.write(message, "utf8", (error) => (error ? reject(error) : resolve()));
    });
  }

  private handleChildFailure(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) {
      return;
    }

    this.rejectPending(error);
    this.terminateChild();
  }

  private terminateChild(): void {
    const child = this.child;
    this.child = null;
    this.initialized = null;
    if (!child || child.killed) {
      return;
    }

    try {
      child.stdin.end();
    } catch {
      // The process tree termination below is authoritative on Windows.
    }

    if (process.platform === "win32" && child.pid) {
      const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      if (result.status === 0) {
        return;
      }
    }

    try {
      child.kill();
    } catch {
      // The process may have already exited between the checks above.
    }
  }
}

function resolveCodexExecutable(): string {
  if (process.platform !== "win32") {
    return "codex";
  }

  const target = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  const platformPackage = process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";
  const commandPaths = findOnPath("codex.cmd");
  for (const commandPath of commandPaths) {
    const executable = path.join(
      path.dirname(commandPath),
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      platformPackage,
      "vendor",
      target,
      "bin",
      "codex.exe"
    );
    if (existsSync(executable)) {
      return executable;
    }
  }

  const direct = findOnPath("codex.exe").find((candidate) => existsSync(candidate));
  if (direct) {
    return direct;
  }

  if (commandPaths.length > 0) {
    // Non-standard npm/pnpm layouts may not expose the platform package at
    // the conventional location. The fixed wrapper command remains safe, and
    // terminateChild() kills the full cmd/Codex process tree on Windows.
    return "codex.cmd";
  }

  throw new Error("Unable to locate the native Codex executable. Install Codex and ensure codex.exe or codex.cmd is on PATH.");
}

function findOnPath(fileName: string): string[] {
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const rawDirectory of (process.env.PATH ?? "").split(path.delimiter)) {
    const directory = rawDirectory.trim().replace(/^"(.*)"$/, "$1");
    if (!directory) {
      continue;
    }

    const candidate = path.join(directory, fileName);
    const key = candidate.toLowerCase();
    if (!seen.has(key) && existsSync(candidate)) {
      seen.add(key);
      matches.push(candidate);
    }
  }

  return matches;
}
