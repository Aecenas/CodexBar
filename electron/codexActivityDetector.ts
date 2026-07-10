import type { ActivityDiagnostics, ActivityState } from "./types.js";
import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const SESSION_ACTIVITY_BUSY_MS = 90_000;
const FULL_SCAN_INTERVAL_MS = 5 * 60_000;

export class CodexActivityDetector {
  private readonly sessionsDir: string;
  private lastProbeAt: number | null = null;
  private lastSource = "not-started";
  private lastNewestSessionWriteAt: number | null = null;
  private lastSessionActivityAt: number | null = null;
  private watcher: FSWatcher | null = null;
  private lastFullScanAt = 0;
  private baselineEstablished = false;

  constructor(codexHome = process.env.CODEX_HOME ?? path.join(homedir(), ".codex")) {
    this.sessionsDir = path.join(codexHome, "sessions");
    this.ensureWatcher();
  }

  async getActivity(): Promise<ActivityState> {
    this.lastProbeAt = Date.now();
    try {
      if (await this.hasRecentSessionActivity()) {
        if (this.lastSource !== "session-watch") {
          this.lastSource = "session-scan";
        }
        return "busy";
      }

      this.lastSource = "idle";
      return "idle";
    } catch {
      this.lastSource = "error";
      return "unknown";
    }
  }

  dispose(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  getDiagnostics(): ActivityDiagnostics {
    return {
      sessionsDir: this.sessionsDir,
      lastProbeAt: this.lastProbeAt,
      lastSource: this.lastSource,
      lastNewestSessionWriteAt: this.lastNewestSessionWriteAt,
      lastSessionActivityAt: this.lastSessionActivityAt
    };
  }

  private async hasRecentSessionActivity(): Promise<boolean> {
    const now = Date.now();
    this.ensureWatcher();
    if (!this.baselineEstablished || !this.watcher || now - this.lastFullScanAt >= FULL_SCAN_INTERVAL_MS) {
      const newestWrite = await this.findNewestSessionWrite(this.sessionsDir);
      this.lastFullScanAt = now;
      if (newestWrite !== null) {
        if (this.baselineEstablished && this.lastNewestSessionWriteAt !== null && newestWrite > this.lastNewestSessionWriteAt) {
          this.lastSessionActivityAt = now;
        } else if (!this.baselineEstablished && now - newestWrite <= SESSION_ACTIVITY_BUSY_MS) {
          this.lastSessionActivityAt = newestWrite;
        }
        this.lastNewestSessionWriteAt = newestWrite;
      }
      this.baselineEstablished = true;
    }

    return (
      now - (this.lastNewestSessionWriteAt ?? 0) <= SESSION_ACTIVITY_BUSY_MS ||
      now - (this.lastSessionActivityAt ?? 0) <= SESSION_ACTIVITY_BUSY_MS
    );
  }

  private ensureWatcher(): void {
    if (this.watcher) {
      return;
    }

    try {
      const watcher = watch(this.sessionsDir, { recursive: true }, (_eventType, fileName) => {
        const name = fileName;
        if (name && !name.endsWith(".jsonl")) {
          return;
        }

        this.lastSessionActivityAt = Date.now();
        this.lastSource = "session-watch";
      });
      watcher.on("error", () => {
        if (this.watcher === watcher) {
          this.watcher = null;
        }
        watcher.close();
      });
      this.watcher = watcher;
    } catch {
      this.watcher = null;
    }
  }

  private async findNewestSessionWrite(directory: string): Promise<number | null> {
    let newest: number | null = null;
    let entries;

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return null;
    }

    const candidates = await Promise.all(entries.map(async (entry): Promise<number | null> => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return this.findNewestSessionWrite(fullPath);
      }

      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        return null;
      }

      try {
        const fileStat = await stat(fullPath);
        return fileStat.mtimeMs;
      } catch {
        // Ignore files that move or are locked while Codex is writing them.
        return null;
      }
    }));

    for (const candidate of candidates) {
      if (candidate !== null && (newest === null || candidate > newest)) {
        newest = candidate;
      }
    }

    return newest;
  }
}
