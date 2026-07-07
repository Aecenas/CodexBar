import { useEffect, useMemo, useRef, useState } from "react";
import type { QuotaHistoryPoint } from "../types";

type PanelKind = "fiveHour" | "week";

interface QuotaHoverPanelProps {
  kind: PanelKind;
  resetAt: number | null;
  tokensUsed: number | null;
  history: QuotaHistoryPoint[];
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function QuotaHoverPanel({
  kind,
  resetAt,
  tokensUsed,
  history,
  onPointerEnter,
  onPointerLeave
}: QuotaHoverPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const windowMs = kind === "fiveHour" ? FIVE_HOUR_MS : WEEK_MS;
  const valueKey = kind === "fiveHour" ? "fiveHourRemaining" : "weekRemaining";
  const label = kind === "fiveHour" ? "5小时窗口" : "一周窗口";
  const points = useMemo(
    () =>
      history
        .filter((point) => now - point.at <= windowMs)
        .map((point) => ({ at: point.at, value: point[valueKey] }))
        .filter((point): point is { at: number; value: number } => point.value !== null),
    [history, now, valueKey, windowMs]
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    drawCurve(canvasRef.current, points, now - windowMs, now);
  }, [now, points, windowMs]);

  return (
    <aside
      className={`quota-panel ${kind}`}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      aria-label={`${label} quota details`}
    >
      <div className="quota-panel-header">
        <span className="quota-panel-title">
          <span>{label}</span>
          <small>{formatTokenUsage(tokensUsed)}</small>
        </span>
        <strong>{formatCountdown(resetAt, now)}</strong>
      </div>
      <canvas ref={canvasRef} className="quota-curve" width={358} height={136} />
    </aside>
  );
}

function drawCurve(
  canvas: HTMLCanvasElement | null,
  points: Array<{ at: number; value: number }>,
  startAt: number,
  endAt: number
): void {
  if (!canvas) {
    return;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const plot = {
    left: 34,
    top: 8,
    right: width - 8,
    bottom: height - 22
  };
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const duration = Math.max(1, endAt - startAt);
  const toX = (at: number) => plot.left + Math.max(0, Math.min(plotWidth, ((at - startAt) / duration) * plotWidth));
  const toY = (remaining: number) => plot.bottom - (Math.max(0, Math.min(100, remaining)) / 100) * plotHeight;

  context.strokeStyle = "rgba(230, 204, 144, 0.16)";
  context.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const y = Math.round(plot.top + (plotHeight / 4) * index) + 0.5;
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
  }

  const ticks = getTimeTicks(startAt, endAt);
  for (const tick of ticks) {
    const x = Math.round(toX(tick)) + 0.5;
    context.beginPath();
    context.moveTo(x, plot.top);
    context.lineTo(x, plot.bottom);
    context.stroke();
  }

  context.strokeStyle = "rgba(229, 199, 132, 0.7)";
  context.lineWidth = 1.25;
  context.beginPath();
  context.moveTo(plot.left, plot.top);
  context.lineTo(plot.left, plot.bottom);
  context.lineTo(plot.right, plot.bottom);
  context.stroke();

  context.fillStyle = "rgba(231, 221, 191, 0.64)";
  context.font = "10px Microsoft YaHei UI, Segoe UI, sans-serif";
  context.fillText("100", 7, plot.top + 4);
  context.fillText("50", 14, plot.top + plotHeight / 2 + 4);
  context.fillText("0", 20, plot.bottom + 3);

  context.fillStyle = "rgba(231, 221, 191, 0.58)";
  context.font = "9px Microsoft YaHei UI, Segoe UI, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "top";
  for (const tick of ticks) {
    const x = toX(tick);
    context.fillText(formatTickLabel(tick, endAt - startAt), x, plot.bottom + 6);
  }
  context.textAlign = "start";
  context.textBaseline = "alphabetic";

  if (points.length < 2) {
    context.fillStyle = "rgba(226, 237, 228, 0.58)";
    context.font = "12px Microsoft YaHei UI, Segoe UI, sans-serif";
    context.fillText("暂无足够记录", plot.left + plotWidth / 2 - 34, plot.top + plotHeight / 2 + 4);
    return;
  }

  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "rgba(103, 236, 180, 0.42)");
  gradient.addColorStop(1, "rgba(137, 255, 212, 0.94)");

  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowColor = "rgba(76, 233, 178, 0.4)";
  context.shadowBlur = 7;
  context.strokeStyle = gradient;
  context.beginPath();
  points.forEach((point, index) => {
    const x = toX(point.at);
    const y = toY(point.value);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
  context.shadowBlur = 0;
}

function getTimeTicks(startAt: number, endAt: number): number[] {
  const duration = endAt - startAt;
  const stepHours = Math.max(1, Math.ceil(duration / HOUR_MS / 6));
  const stepMs = stepHours * HOUR_MS;
  const firstTick = Math.ceil(startAt / stepMs) * stepMs;
  const ticks: number[] = [];

  for (let tick = firstTick; tick <= endAt; tick += stepMs) {
    ticks.push(tick);
  }

  return ticks;
}

function formatTickLabel(timestamp: number, duration: number): string {
  const date = new Date(timestamp);
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  if (duration > 24 * HOUR_MS) {
    return `${date.getMonth() + 1}/${date.getDate()} ${hours}:${minutes}`;
  }

  return `${hours}:${minutes}`;
}

function formatCountdown(resetAt: number | null, now: number): string {
  if (!resetAt) {
    return "--:--:--";
  }

  const totalSeconds = Math.max(0, Math.floor(resetAt - now / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}天 ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatTokenUsage(tokensUsed: number | null): string {
  if (tokensUsed === null) {
    return "-- token";
  }

  const value = Math.max(0, tokensUsed);
  if (value >= 1_000_000_000) {
    return `${formatCompactNumber(value / 1_000_000_000)}G token`;
  }

  if (value >= 1_000_000) {
    return `${formatCompactNumber(value / 1_000_000)}M token`;
  }

  if (value >= 1_000) {
    return `${formatCompactNumber(value / 1_000)}K token`;
  }

  return `${Math.round(value)} token`;
}

function formatCompactNumber(value: number): string {
  if (value >= 100) {
    return Math.round(value).toString();
  }

  if (value >= 10) {
    return value.toFixed(1).replace(/\.0$/, "");
  }

  return value.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
