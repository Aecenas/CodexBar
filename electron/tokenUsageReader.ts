import { homedir } from "node:os";
import path from "node:path";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import readline from "node:readline";

interface CachedSessionTokens {
  mtimeMs: number;
  size: number;
  lastTotal: number | null;
  buckets: TokenUsageBucket[];
}

interface TokenUsageBucket {
  at: number;
  tokens: number;
}

export interface TokenUsageSnapshot {
  fiveHourTokensUsed: number;
  weekTokensUsed: number;
  fetchedAt: number;
}

export interface TokenUsageDiagnostics {
  sessionsDir: string;
  cachedFiles: number;
  cachedBuckets: number;
  lastReadAt: number | null;
}

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_RETENTION_MS = WEEK_MS + 60 * 60 * 1000;

export class TokenUsageReader {
  private readonly sessionsDir: string;
  private readonly cache = new Map<string, CachedSessionTokens>();
  private lastReadAt: number | null = null;

  constructor(codexHome = process.env.CODEX_HOME ?? path.join(homedir(), ".codex")) {
    this.sessionsDir = path.join(codexHome, "sessions");
  }

  async readUsage(now = Date.now()): Promise<TokenUsageSnapshot> {
    await this.refreshCache(now);

    const fiveHourStart = now - FIVE_HOUR_MS;
    const weekStart = now - WEEK_MS;
    let fiveHourTokensUsed = 0;
    let weekTokensUsed = 0;

    for (const cached of this.cache.values()) {
      for (const bucket of cached.buckets) {
        if (bucket.at >= weekStart && bucket.at <= now) {
          weekTokensUsed += bucket.tokens;
        }
        if (bucket.at >= fiveHourStart && bucket.at <= now) {
          fiveHourTokensUsed += bucket.tokens;
        }
      }
    }

    return {
      fiveHourTokensUsed,
      weekTokensUsed,
      fetchedAt: now
    };
  }

  getDiagnostics(): TokenUsageDiagnostics {
    let cachedBuckets = 0;
    for (const cached of this.cache.values()) {
      cachedBuckets += cached.buckets.length;
    }

    return {
      sessionsDir: this.sessionsDir,
      cachedFiles: this.cache.size,
      cachedBuckets,
      lastReadAt: this.lastReadAt
    };
  }

  private async refreshCache(now: number): Promise<void> {
    const files = await listJsonlFiles(this.sessionsDir);
    const seen = new Set<string>();

    for (const file of files) {
      seen.add(file);
      const metadata = await stat(file);

      if (now - metadata.mtimeMs > SESSION_RETENTION_MS) {
        this.cache.delete(file);
        continue;
      }

      const cached = this.cache.get(file);
      if (cached && cached.mtimeMs === metadata.mtimeMs && cached.size === metadata.size) {
        continue;
      }

      if (cached && metadata.size >= cached.size) {
        const parsed = await parseTokenEvents(file, cached.size, cached.lastTotal);
        this.cache.set(file, {
          mtimeMs: metadata.mtimeMs,
          size: metadata.size,
          lastTotal: parsed.lastTotal,
          buckets: mergeBuckets(cached.buckets, parsed.buckets, now)
        });
        continue;
      }

      const parsed = await parseTokenEvents(file, 0, null);
      this.cache.set(file, {
        mtimeMs: metadata.mtimeMs,
        size: metadata.size,
        lastTotal: parsed.lastTotal,
        buckets: parsed.buckets.filter((bucket) => now - bucket.at <= SESSION_RETENTION_MS)
      });
    }

    for (const file of this.cache.keys()) {
      if (!seen.has(file)) {
        this.cache.delete(file);
      }
    }

    this.lastReadAt = now;
  }
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const result: string[] = [];

  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          return;
        }

        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          result.push(fullPath);
        }
      })
    );
  }

  await walk(root);
  return result;
}

async function parseTokenEvents(
  file: string,
  start: number,
  previousTotal: number | null
): Promise<{ buckets: TokenUsageBucket[]; lastTotal: number | null }> {
  const stream = createReadStream(file, { encoding: "utf8", start });
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });
  const buckets = new Map<number, number>();
  let lastTotal = previousTotal;

  for await (const line of lines) {
    if (!line.includes('"token_count"')) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as {
        timestamp?: unknown;
        payload?: {
          info?: {
            last_token_usage?: { total_tokens?: unknown };
            total_token_usage?: { total_tokens?: unknown };
          };
        };
      };
      const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
      if (!Number.isFinite(timestamp)) {
        continue;
      }

      const lastTokens = entry.payload?.info?.last_token_usage?.total_tokens;
      const totalTokens = entry.payload?.info?.total_token_usage?.total_tokens;
      const tokens =
        typeof lastTokens === "number" && Number.isFinite(lastTokens)
          ? lastTokens
          : getTotalDelta(totalTokens, lastTotal);

      if (typeof totalTokens === "number" && Number.isFinite(totalTokens)) {
        lastTotal = totalTokens;
      }

      if (tokens > 0) {
        const bucketAt = Math.floor(timestamp / 60_000) * 60_000;
        buckets.set(bucketAt, (buckets.get(bucketAt) ?? 0) + tokens);
      }
    } catch {
      // A partial trailing JSONL line should not break the quota UI.
    }
  }

  return {
    buckets: Array.from(buckets, ([at, tokens]) => ({ at, tokens })).sort((a, b) => a.at - b.at),
    lastTotal
  };
}

function mergeBuckets(current: TokenUsageBucket[], appended: TokenUsageBucket[], now: number): TokenUsageBucket[] {
  const buckets = new Map<number, number>();

  for (const bucket of current) {
    if (now - bucket.at <= SESSION_RETENTION_MS) {
      buckets.set(bucket.at, bucket.tokens);
    }
  }

  for (const bucket of appended) {
    if (now - bucket.at <= SESSION_RETENTION_MS) {
      buckets.set(bucket.at, (buckets.get(bucket.at) ?? 0) + bucket.tokens);
    }
  }

  return Array.from(buckets, ([at, tokens]) => ({ at, tokens })).sort((a, b) => a.at - b.at);
}

function getTotalDelta(totalTokens: unknown, previousTotal: number | null): number {
  if (typeof totalTokens !== "number" || !Number.isFinite(totalTokens)) {
    return 0;
  }

  if (previousTotal === null || totalTokens < previousTotal) {
    return totalTokens;
  }

  return totalTokens - previousTotal;
}
