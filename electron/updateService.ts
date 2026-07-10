import { app, net, shell, type WebContents } from "electron";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { UpdateDownloadProgress, UpdateStatus } from "./types.js";
import {
  getAssetSha256,
  isCodexBarInstallerName,
  normalizeDownloadProxyPrefix,
  type ReleaseAssetMetadata
} from "./updateValidation.js";

interface GitHubAsset extends ReleaseAssetMetadata {
  browser_download_url: string;
  size?: number;
}

interface GitHubLatestRelease {
  tag_name?: string;
  html_url?: string;
  assets?: GitHubAsset[];
}

const latestReleaseApiUrl = "https://api.github.com/repos/Aecenas/CodexBar/releases/latest";
const releasesUrl = "https://github.com/Aecenas/CodexBar/releases";
const RELEASE_REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export async function checkForUpdate(): Promise<UpdateStatus> {
  const release = await requestJson<GitHubLatestRelease>(latestReleaseApiUrl);
  return releaseToStatus(release);
}

export async function downloadAndInstallUpdate(webContents: WebContents, downloadProxyPrefix = ""): Promise<UpdateStatus> {
  const release = await requestJson<GitHubLatestRelease>(latestReleaseApiUrl);
  const status = releaseToStatus(release);

  if (!status.updateAvailable) {
    return status;
  }

  const installer = findInstallerAsset(release);
  if (!installer) {
    throw new Error("没有找到可下载的 Windows 安装包。");
  }

  const updateDir = path.join(app.getPath("userData"), "updates");
  await mkdir(updateDir, { recursive: true });

  const installerPath = path.join(updateDir, sanitizeFileName(installer.name));
  const partialPath = `${installerPath}.${process.pid}.part`;
  const expectedSha256 = getAssetSha256(installer);
  await unlink(partialPath).catch(() => undefined);

  try {
    const downloaded = await downloadFile(
      applyDownloadProxy(installer.browser_download_url, downloadProxyPrefix),
      partialPath,
      (progress) => {
        if (!webContents.isDestroyed()) {
          webContents.send("updates:download-progress", progress);
        }
      }
    );
    if (downloaded.sha256 !== expectedSha256) {
      throw new Error("安装包 SHA-256 校验失败，已拒绝执行。");
    }
    if (typeof installer.size === "number" && installer.size > 0 && downloaded.receivedBytes !== installer.size) {
      throw new Error("安装包大小与 GitHub Release 元数据不一致，已拒绝执行。");
    }

    await unlink(installerPath).catch(() => undefined);
    await rename(partialPath, installerPath);
  } catch (error) {
    await unlink(partialPath).catch(() => undefined);
    throw error;
  }

  const openError = await shell.openPath(installerPath);
  if (openError) {
    throw new Error(openError);
  }

  return {
    ...status,
    downloading: false,
    downloadProgress: 100
  };
}

function applyDownloadProxy(url: string, proxyPrefix: string): string {
  const prefix = normalizeDownloadProxyPrefix(proxyPrefix);
  if (!prefix) {
    return url;
  }

  return `${prefix}${url}`;
}

function releaseToStatus(release: GitHubLatestRelease): UpdateStatus {
  const latestVersion = normalizeVersion(release.tag_name ?? "");

  if (!latestVersion) {
    throw new Error("GitHub latest release did not include a tag.");
  }

  return {
    currentVersion: app.getVersion(),
    latestVersion,
    releaseUrl: release.html_url ?? releasesUrl,
    updateAvailable: isNewerVersion(latestVersion, app.getVersion()),
    checking: false,
    downloading: false,
    downloadProgress: null,
    lastCheckedAt: Date.now(),
    error: null
  };
}

function findInstallerAsset(release: GitHubLatestRelease): GitHubAsset | null {
  return (
    release.assets?.find((asset) => {
      const name = asset.name.toLowerCase();
      return isCodexBarInstallerName(name);
    }) ?? null
  );
}

async function requestJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELEASE_REQUEST_TIMEOUT_MS);
  try {
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "CodexBar"
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub release check failed: ${response.status}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("GitHub release check timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadFile(
  url: string,
  destination: string,
  onProgress: (progress: UpdateDownloadProgress) => void
): Promise<{ receivedBytes: number; sha256: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "CodexBar"
      }
    });

    if (!response.ok) {
      throw new Error(`下载安装包失败: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("下载安装包失败: 响应内容为空。");
    }

    const totalBytes = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    const safeTotalBytes = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : null;
    const hash = createHash("sha256");
    let receivedBytes = 0;
    const progress = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += bytes.length;
        hash.update(bytes);
        onProgress({
          receivedBytes,
          totalBytes: safeTotalBytes,
          percent: safeTotalBytes === null ? null : Math.min(100, Math.round((receivedBytes / safeTotalBytes) * 100))
        });
        callback(null, bytes);
      }
    });
    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    await pipeline(source, progress, createWriteStream(destination), { signal: controller.signal });

    if (safeTotalBytes !== null && receivedBytes !== safeTotalBytes) {
      throw new Error("下载安装包失败: 下载内容长度不完整。");
    }

    return { receivedBytes, sha256: hash.digest("hex") };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("下载安装包超时，已取消。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = parseVersion(latest);
  const currentParts = parseVersion(current);
  const length = Math.max(latestParts.length, currentParts.length);

  for (let index = 0; index < length; index += 1) {
    const latestPart = latestParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;

    if (latestPart > currentPart) {
      return true;
    }

    if (latestPart < currentPart) {
      return false;
    }
  }

  return false;
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, "");
}

function parseVersion(value: string): number[] {
  return normalizeVersion(value)
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[<>:"/\\|?*]/g, "_");
}
