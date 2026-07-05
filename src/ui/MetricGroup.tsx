import { useEffect, useMemo, useRef, useState } from "react";

interface MetricGroupProps {
  label: string;
  value: number | null;
  resetAt: number | null;
}

type MetricTone = "good" | "warn" | "danger" | "muted";
type GlyphName = "dash" | "percent" | `${number}`;
type RollSnapshot = {
  glyphs: GlyphName[];
  tone: MetricTone;
};

const digitModules = import.meta.glob("../assets/digits/*/*.png", {
  eager: true,
  query: "?url",
  import: "default"
}) as Record<string, string>;

const digitAssets = buildDigitAssetMap(digitModules);

export function MetricGroup({ label, value, resetAt }: MetricGroupProps) {
  const previousValue = useRef(value);
  const [changed, setChanged] = useState(false);
  const [rollFrom, setRollFrom] = useState<RollSnapshot | null>(null);

  useEffect(() => {
    if (value !== previousValue.current) {
      setRollFrom({
        glyphs: formatGlyphs(previousValue.current),
        tone: getMetricTone(previousValue.current)
      });
      setChanged(true);
      const timer = window.setTimeout(() => {
        setChanged(false);
        setRollFrom(null);
      }, 520);
      previousValue.current = value;
      return () => window.clearTimeout(timer);
    }

    previousValue.current = value;
    return undefined;
  }, [value]);

  const valueTone = useMemo<MetricTone>(() => getMetricTone(value), [value]);

  const glyphs = useMemo(() => formatGlyphs(value), [value]);
  const ariaValue = value === null ? "-%" : `${Math.round(value)}%`;

  return (
    <div className="metric" title={formatReset(resetAt)}>
      <span className="metric-label">{label}</span>
      <span className={`metric-value ${changed ? "changed" : ""}`} aria-label={`${label} ${ariaValue}`}>
        <span className="metric-roll-window">
          {rollFrom ? <GlyphRow glyphs={rollFrom.glyphs} tone={rollFrom.tone} variant="previous" /> : null}
          <GlyphRow glyphs={glyphs} tone={valueTone} variant="current" />
        </span>
      </span>
    </div>
  );
}

function GlyphRow({ glyphs, tone, variant }: { glyphs: GlyphName[]; tone: MetricTone; variant: "current" | "previous" }) {
  return (
    <span className={`metric-glyph-row metric-glyph-row-${variant} ${tone}`}>
      {glyphs.map((glyph, index) => (
        <img
          aria-hidden="true"
          className={`metric-glyph metric-glyph-${glyph}`}
          key={`${glyph}-${index}`}
          src={digitAssets[tone][glyph]}
          alt=""
          draggable={false}
        />
      ))}
    </span>
  );
}

function formatReset(resetAt: number | null): string {
  if (!resetAt) {
    return "Reset time unavailable";
  }

  return `Resets ${new Date(resetAt * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function getMetricTone(value: number | null): MetricTone {
  if (value === null) {
    return "muted";
  }
  if (value <= 10) {
    return "danger";
  }
  if (value <= 25) {
    return "warn";
  }
  return "good";
}

function formatGlyphs(value: number | null): GlyphName[] {
  if (value === null) {
    return ["dash", "percent"];
  }

  return `${Math.round(value)}%`.split("").map((char) => {
    if (char === "%") {
      return "percent";
    }
    return char as GlyphName;
  });
}

function buildDigitAssetMap(modules: Record<string, string>): Record<MetricTone, Record<GlyphName, string>> {
  const assets: Partial<Record<MetricTone, Partial<Record<GlyphName, string>>>> = {};

  for (const [path, url] of Object.entries(modules)) {
    const [, tone, fileName] = path.match(/digits\/(good|warn|danger|muted)\/(.+)\.png$/) ?? [];
    if (!tone || !fileName) {
      continue;
    }

    const glyph = fileName as GlyphName;
    assets[tone as MetricTone] ??= {};
    assets[tone as MetricTone]![glyph] = url;
  }

  return assets as Record<MetricTone, Record<GlyphName, string>>;
}
