/**
 * Chart styling read from CSS custom properties so charts follow the active
 * theme. Series colours follow the validated categorical order (fixed by
 * entity, never by rank).
 */
export interface ChartPalette {
  surface: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  neutral: string;
  series: string[];
  divNeg: string;
  divMid: string;
  divPos: string;
  accent: string;
  critical: string;
  warning: string;
  fontSans: string;
  fontMono: string;
}

function v(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const x = style.getPropertyValue(name).trim();
  return x || fallback;
}

export function readPalette(): ChartPalette {
  const style = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : ({ getPropertyValue: () => '' } as unknown as CSSStyleDeclaration);
  return {
    surface: v(style, '--chart-surface', '#ffffff'),
    ink: v(style, '--chart-ink', '#141a16'),
    ink2: v(style, '--chart-ink-2', '#52514e'),
    muted: v(style, '--chart-muted', '#898781'),
    grid: v(style, '--chart-grid', '#e8e7e1'),
    axis: v(style, '--chart-axis', '#c3c2b7'),
    neutral: v(style, '--chart-neutral', '#8a918c'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(style, `--series-${i}`, '#2a78d6')),
    divNeg: v(style, '--div-neg', '#2a78d6'),
    divMid: v(style, '--div-mid', '#f0efec'),
    divPos: v(style, '--div-pos', '#e34948'),
    accent: v(style, '--accent', '#17703f'),
    critical: v(style, '--critical', '#c22f2f'),
    warning: v(style, '--warning', '#9a6700'),
    fontSans: v(style, '--font-sans', 'system-ui'),
    fontMono: v(style, '--font-mono', 'monospace'),
  };
}

export function seriesColor(p: ChartPalette, slot: number): string {
  return p.series[slot % p.series.length]!;
}

/** Shared axis styling: recessive hairline grid and axes. */
export function axisStyle(p: ChartPalette) {
  return {
    axisLine: { lineStyle: { color: p.axis } },
    axisTick: { lineStyle: { color: p.axis } },
    axisLabel: { color: p.muted, fontFamily: p.fontSans, fontSize: 11 },
    splitLine: { lineStyle: { color: p.grid, type: 'solid' as const } },
    nameTextStyle: { color: p.ink2, fontFamily: p.fontSans, fontSize: 11 },
  };
}

/** Axis styling for y axes: the axis name is left-aligned above the axis. */
export function yAxisStyle(p: ChartPalette) {
  const a = axisStyle(p);
  return { ...a, nameTextStyle: { ...a.nameTextStyle, align: 'left' as const } };
}

export function baseOption(p: ChartPalette) {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: p.fontSans, color: p.ink },
    animation: false,
    tooltip: {
      backgroundColor: p.surface,
      borderColor: p.axis,
      borderWidth: 1,
      textStyle: { color: p.ink, fontFamily: p.fontSans, fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.12); border-radius: 6px;',
      confine: true,
    },
    legend: {
      textStyle: { color: p.ink2, fontSize: 11.5 },
      itemWidth: 14,
      itemHeight: 8,
      top: 0,
      left: 8,
      icon: 'roundRect',
      type: 'scroll' as const,
    },
  };
}

/** Mixes two #rrggbb colours: t = 0 gives a, t = 1 gives b. */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (h: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
    const n = m ? parseInt(m[1]!, 16) : 0x888888;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const x = parse(a);
  const y = parse(b);
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
