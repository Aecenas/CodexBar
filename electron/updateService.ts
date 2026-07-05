import { app, shell, type WebContents } from "electron";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { URL } from "node:url";
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

export async function downloadAndInstallUpdate(webContents: WebContents): Promise<UpdateStatus> {
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
    await downloadFile(installer.browser_download_url, installerPath, (progress) => {
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

function requestJson<T>(url: string, redirects = 0): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "CodexBar"
        }
      },
      (response) => {
        if (isRedirect(response.statusCode) && response.headers.location) {
          response.resume();
          if (redirects >= 5) {
            reject(new Error("Too many redirects."));
            return;
          }
          resolve(requestJson<T>(new URL(response.headers.location, url).toString(), redirects + 1));
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`GitHub release check failed: ${response.statusCode}`));
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("error", reject);
  });
}

function downloadFile(
  url: string,
  destination: string,
  onProgress: (progress: UpdateDownloadProgress) => void,
  redirects = 0
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "CodexBar"
        }
      },
      (response) => {
        if (isRedirect(response.statusCode) && response.headers.location) {
          response.resume();
          if (redirects >= 5) {
            reject(new Error("Too many redirects."));
            return;
          }
          resolve(downloadFile(new URL(response.headers.location, url).toString(), destination, onProgress, redirects + 1));
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`下载安装包失败: ${response.statusCode}`));
          return;
        }

        const totalBytes = Number.parseInt(response.headers["content-length"] ?? "", 10);
        const safeTotalBytes = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : null;
        let receivedBytes = 0;
        const file = createWriteStream(destination);

        response.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;
          onProgress({
            receivedBytes,
            totalBytes: safeTotalBytes,
            percent: safeTotalBytes === null ? null : Math.min(100, Math.round((receivedBytes / safeTotalBytes) * 100))
          });
        });

        response.pipe(file);
        file.on("finish", () => {
          file.close(() => resolve());
        });
        file.on("error", reject);
      }
    );

    request.on("error", reject);
  });
}

function isRedirect(statusCode: number | undefined): boolean {
  return typeof statusCode === "number" && statusCode >= 300 && statusCode < 400;
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
