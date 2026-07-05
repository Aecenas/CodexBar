import type { CodexAppServerClient } from "./codexAppServerClient.js";
import type { ActivityState } from "./types.js";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const RECENT_SESSION_WRITE_BUSY_MS = 20_000;
const CODEX_HOME = process.env.CODEX_HOME || path.join(homedir(), ".codex");

interface ThreadLike {
  status?: { type?: string } | null;
}

export class CodexActivityDetector {
  constructor(private readonly client: CodexAppServerClient) {}

  async getActivity(): Promise<ActivityState> {
    try {
      const threads = (await this.client.listThreads(8)) as ThreadLike[];
      if (threads.some((thread) => thread.status?.type === "active")) {
        return "busy";
      }

      return (await this.hasRecentSessionWrite()) ? "busy" : "idle";
    } catch {
      try {
        return (await this.hasRecentSessionWrite()) ? "busy" : "unknown";
      } catch {
        return "unknown";
      }
    }
  }

  private async hasRecentSessionWrite(): Promise<boolean> {
    const newestWrite = await this.findNewestSessionWrite(path.join(CODEX_HOME, "sessions"));
    if (!newestWrite) {
      return false;
    }

    return Date.now() - newestWrite <= RECENT_SESSION_WRITE_BUSY_MS;
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
