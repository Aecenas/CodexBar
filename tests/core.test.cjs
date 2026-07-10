const assert = require("node:assert/strict");
const { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { CodexActivityDetector } = require("../dist-electron/codexActivityDetector.js");
const { CodexAppServerClient } = require("../dist-electron/codexAppServerClient.js");
const { MAX_POLLING_SETTINGS, normalizePollingSettings } = require("../dist-electron/pollingSettings.js");
const { RefreshScheduler } = require("../dist-electron/refreshScheduler.js");
const { TokenUsageReader } = require("../dist-electron/tokenUsageReader.js");
const {
  getAssetSha256,
  isCodexBarInstallerName,
  normalizeDownloadProxyPrefix
} = require("../dist-electron/updateValidation.js");

test("rate-limit selection keeps the canonical codex bucket", async () => {
  const client = new CodexAppServerClient();
  client.request = async () => ({
    rateLimits: rateLimit("codex", 12, 34),
    rateLimitsByLimitId: {
      codex: rateLimit("codex", 12, 34),
      codex_bengalfox: rateLimit("codex_bengalfox", 70, 80)
    }
  });

  const snapshot = await client.readRateLimits();
  assert.equal(snapshot.limitId, "codex");
  assert.equal(snapshot.fiveHour.remainingPercent, 88);
  assert.equal(snapshot.week.remainingPercent, 66);
});

test("a valid rate-limit response may omit the secondary window", async () => {
  const client = new CodexAppServerClient();
  client.request = async () => ({
    rateLimits: {
      ...rateLimit("codex", 25, 0),
      secondary: null
    }
  });

  const snapshot = await client.readRateLimits();
  assert.equal(snapshot.fiveHour.remainingPercent, 75);
  assert.equal(snapshot.week, null);
});

test("a failed app-server initialization can be retried", async () => {
  const client = new CodexAppServerClient();
  let attempts = 0;
  client.start = () => undefined;
  client.initialize = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("temporary initialization failure");
    }
  };

  await assert.rejects(() => client.ensureInitialized(), /temporary initialization failure/);
  await client.ensureInitialized();
  assert.equal(attempts, 2);
});

test("failed quota reads are serialized and backed off while token usage remains independent", async () => {
  let activeReads = 0;
  let maxActiveReads = 0;
  let quotaReads = 0;
  let tokenReads = 0;
  const payloads = [];
  const window = {
    isDestroyed: () => false,
    webContents: { send: (_channel, payload) => payloads.push(payload) }
  };
  const client = {
    readRateLimits: async () => {
      quotaReads += 1;
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await delay(30);
      activeReads -= 1;
      throw new Error("offline");
    }
  };
  const activity = {
    getActivity: async () => "idle",
    getDiagnostics: () => ({}),
    dispose: () => undefined
  };
  const tokenUsage = {
    readUsage: async () => {
      tokenReads += 1;
      return { fiveHourTokensUsed: 10, weekTokensUsed: 20, fetchedAt: Date.now() };
    },
    getDiagnostics: () => ({})
  };
  const scheduler = new RefreshScheduler(window, client, activity, tokenUsage);

  scheduler.start();
  await delay(100);
  scheduler.stop();

  assert.equal(quotaReads, 1);
  assert.equal(maxActiveReads, 1);
  assert.ok(tokenReads >= 1);
  assert.ok(payloads.some((payload) => payload.fiveHourTokensUsed === 10));
});

test("token reader retains partial lines and deduplicates cumulative totals", async () => {
  const codexHome = await mkdtemp(path.join(tmpdir(), "codexbar-token-test-"));
  const sessionsDir = path.join(codexHome, "sessions");
  const sessionFile = path.join(sessionsDir, "session.jsonl");
  const now = Date.now();
  await mkdir(sessionsDir, { recursive: true });
  const first = tokenEvent(now - 2_000, 10, 10);
  const second = tokenEvent(now - 1_000, 25, 15);
  const splitAt = Math.floor(second.length / 2);

  try {
    await writeFile(sessionFile, `${first}\n${second.slice(0, splitAt)}`, "utf8");
    const reader = new TokenUsageReader(codexHome);
    const initial = await reader.readUsage(now);
    assert.equal(initial.fiveHourTokensUsed, 10);

    await appendFile(sessionFile, `${second.slice(splitAt)}\n`, "utf8");
    const completed = await reader.readUsage(now);
    assert.equal(completed.fiveHourTokensUsed, 25);

    await appendFile(sessionFile, `${second}\n`, "utf8");
    const duplicated = await reader.readUsage(now);
    assert.equal(duplicated.fiveHourTokensUsed, 25);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("an old session does not mark the app busy on the first probe", async () => {
  const codexHome = await mkdtemp(path.join(tmpdir(), "codexbar-activity-test-"));
  const sessionsDir = path.join(codexHome, "sessions");
  const sessionFile = path.join(sessionsDir, "old.jsonl");
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(sessionFile, "{}\n", "utf8");
  const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await utimes(sessionFile, old, old);
  const detector = new CodexActivityDetector(codexHome);

  try {
    assert.equal(await detector.getActivity(), "idle");
  } finally {
    detector.dispose();
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("polling settings cannot overflow the native timer range", () => {
  const normalized = normalizePollingSettings({
    activityCheckSeconds: Number.MAX_SAFE_INTEGER,
    busyQuotaSeconds: Number.MAX_SAFE_INTEGER,
    idleQuotaSeconds: Number.MAX_SAFE_INTEGER
  });

  assert.deepEqual(normalized, MAX_POLLING_SETTINGS);
  for (const value of Object.values(normalized)) {
    assert.ok(value * 1000 <= 2_147_483_647);
  }
});

test("update validation accepts current installer names and rejects insecure metadata", () => {
  assert.equal(isCodexBarInstallerName("CodexBar.Setup.1.0.2.exe"), true);
  assert.equal(isCodexBarInstallerName("CodexBar Setup 1.0.2.exe"), true);
  assert.equal(isCodexBarInstallerName("uninstaller.exe"), false);
  assert.equal(normalizeDownloadProxyPrefix("http://proxy.example/"), "");
  assert.equal(normalizeDownloadProxyPrefix("https://proxy.example"), "https://proxy.example/");
  assert.equal(
    getAssetSha256({ name: "CodexBar.Setup.1.0.2.exe", digest: `sha256:${"a".repeat(64)}` }),
    "a".repeat(64)
  );
  assert.throws(() => getAssetSha256({ name: "CodexBar.Setup.1.0.2.exe", digest: null }));
});

function rateLimit(limitId, primaryUsed, secondaryUsed) {
  return {
    limitId,
    planType: "plus",
    primary: { usedPercent: primaryUsed, resetsAt: 1_800_000_000, windowDurationMins: 300 },
    secondary: { usedPercent: secondaryUsed, resetsAt: 1_800_100_000, windowDurationMins: 10_080 }
  };
}

function tokenEvent(timestamp, total, last) {
  return JSON.stringify({
    timestamp: new Date(timestamp).toISOString(),
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { total_tokens: total },
        last_token_usage: { total_tokens: last }
      }
    }
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
