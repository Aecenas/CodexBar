import type { CodexAppServerClient } from "./codexAppServerClient.js";
import type { ActivityDiagnostics, ActivityState } from "./types.js";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const SESSION_ACTIVITY_BUSY_MS = 90_000;
const CODEX_HOME = process.env.CODEX_HOME || path.join(homedir(), ".codex");
const BUSY_THREAD_STATUSES = new Set(["running", "active", "working", "streaming", "processing", "pending"]);

interface ThreadLike {
  status?: { type?: string } | null;
}

export class CodexActivityDetector {
  private readonly sessionsDir = path.join(CODEX_HOME, "sessions");
  private lastProbeAt: number | null = null;
  private lastSource = "not-started";
  private lastThreadStatus: string | null = null;
  private lastNewestSessionWriteAt: number | null = null;
  private lastSessionActivityAt: number | null = null;

  constructor(private readonly client: CodexAppServerClient) {}

  async getActivity(): Promise<ActivityState> {
    this.lastProbeAt = Date.now();
    try {
      const threads = (await this.client.listThreads(8)) as ThreadLike[];
      this.lastThreadStatus = threads.map((thread) => thread.status?.type).find(Boolean) ?? null;
      if (threads.some((thread) => BUSY_THREAD_STATUSES.has(thread.status?.type ?? ""))) {
        this.lastSource = "thread-status";
        return "busy";
      }

      if (await this.hasRecentSessionActivity()) {
        this.lastSource = "session-activity";
        return "busy";
      }

      this.lastSource = "idle";
      return "idle";
    } catch {
      try {
        if (await this.hasRecentSessionActivity()) {
          this.lastSource = "fallback-session-activity";
          return "busy";
        }

        this.lastSource = "unknown";
        return "unknown";
      } catch {
        this.lastSource = "error";
        return "unknown";
      }
    }
  }

  getDiagnostics(): ActivityDiagnostics {
    return {
      sessionsDir: this.sessionsDir,
      lastProbeAt: this.lastProbeAt,
      lastSource: this.lastSource,
      lastThreadStatus: this.lastThreadStatus,
      lastNewestSessionWriteAt: this.lastNewestSessionWriteAt,
      lastSessionActivityAt: this.lastSessionActivityAt
    };
  }

  private async hasRecentSessionActivity(): Promise<boolean> {
    const newestWrite = await this.findNewestSessionWrite(this.sessionsDir);
    if (!newestWrite) {
      return false;
    }

    const now = Date.now();
    if (this.lastNewestSessionWriteAt === null || newestWrite > this.lastNewestSessionWriteAt) {
      this.lastNewestSessionWriteAt = newestWrite;
      this.lastSessionActivityAt = now;
    }

    return now - newestWrite <= SESSION_ACTIVITY_BUSY_MS || now - (this.lastSessionActivityAt ?? 0) <= SESSION_ACTIVITY_BUSY_MS;
  }

  private async findNewestSessionWrite(directory: string): Promise<number | null> {
    let newest: number | null = null;
    let entries;

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.findNewestSessionWrite(fullPath);
        if (nested !== null && (newest === null || nested > newest)) {
          newest = nested;
        }
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }

      try {
        const fileStat = await stat(fullPath);
        const modifiedAt = fileStat.mtimeMs;
        if (newest === null || modifiedAt > newest) {
          newest = modifiedAt;
        }
      } catch {
        // Ignore files that move or are locked while Codex is writing them.
      }
    }

    return newest;
  }
}
