import { app, net, shell, type WebContents } from "electron";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { UpdateDownloadProgress, UpdateStatus } from "./types.js";

interface GitHubAsset {
  name: string;
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

  try {
    await downloadFile(applyDownloadProxy(installer.browser_download_url, downloadProxyPrefix), installerPath, (progress) => {
      webContents.send("updates:download-progress", progress);
    });
  } catch (error) {
    await unlink(installerPath).catch(() => undefined);
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
  const prefix = normalizeProxyPrefix(proxyPrefix);
  if (!prefix) {
    return url;
  }

  return `${prefix}${url}`;
}

function normalizeProxyPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }

    return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
  } catch {
    return "";
  }
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
      return name.endsWith(".exe") && !name.includes("uninstaller");
    }) ?? null
  );
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await net.fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "CodexBar"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub release check failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function downloadFile(
  url: string,
  destination: string,
  onProgress: (progress: UpdateDownloadProgress) => void
): Promise<void> {
  const response = await net.fetch(url, {
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
  let receivedBytes = 0;
  const file = createWriteStream(destination);
  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      receivedBytes += value.byteLength;
      if (!file.write(Buffer.from(value))) {
        await new Promise<void>((resolve, reject) => {
          file.once("drain", resolve);
          file.once("error", reject);
        });
      }

      onProgress({
        receivedBytes,
        totalBytes: safeTotalBytes,
        percent: safeTotalBytes === null ? null : Math.min(100, Math.round((receivedBytes / safeTotalBytes) * 100))
      });
    }
  } finally {
    reader.releaseLock();
  }

  await new Promise<void>((resolve, reject) => {
    file.end(() => resolve());
    file.once("error", reject);
  });
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
