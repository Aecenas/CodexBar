export interface ReleaseAssetMetadata {
  name: string;
  digest?: string | null;
}

export function isCodexBarInstallerName(name: string): boolean {
  return /^codexbar[ ._-]+setup[ ._-]+.+\.exe$/i.test(name.trim());
}

export function normalizeDownloadProxyPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      return "";
    }

    return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
  } catch {
    return "";
  }
}

export function getAssetSha256(asset: ReleaseAssetMetadata): string {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest ?? "");
  if (!match) {
    throw new Error("GitHub Release 安装包缺少可验证的 SHA-256 摘要。");
  }

  return match[1].toLowerCase();
}
