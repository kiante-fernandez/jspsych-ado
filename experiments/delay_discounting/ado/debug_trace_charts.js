const PANEL_ID = "ado-info-gain-debug-panel";
const SVG_WIDTH = 360;
const SVG_HEIGHT = 190;
const MARGIN = {
  top: 16,
  right: 14,
  bottom: 32,
  left: 50,
};
const COLORS = {
  max_mutual_info: "#2563eb",
  realized_information_gain: "#dc2626",
  axis: "#6b7280",
  grid: "#e5e7eb",
  text: "#111827",
  muted: "#4b5563",
  background: "#ffffff",
};

function formatTraceNumber(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "NA";
  }

  const number = Number(value);
  if (number === 0) {
    return "0";
  }
  if (Math.abs(number) < 0.001 || Math.abs(number) >= 1000) {
    return number.toPrecision(digits);
  }
  return Number(number.toFixed(digits)).toString();
}

function coordinate(value) {
  return Number(value).toFixed(1);
}

function getFiniteTracePoints(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value, index) => ({
      trial: index + 1,
      missing: value === null || value === undefined,
      value: Number(value),
    }))
    .filter(point => !point.missing && Number.isFinite(point.value))
    .map(point => ({
      trial: point.trial,
      value: point.value,
    }));
}

function getInfoGainScale(max_points, realized_points, options = {}) {
  const width = Number.isFinite(Number(options.width)) ? Number(options.width) : SVG_WIDTH;
  const height = Number.isFinite(Number(options.height)) ? Number(options.height) : SVG_HEIGHT;
  const points = [...max_points, ...realized_points];
  const max_trial = Math.max(1, ...points.map(point => point.trial));
  const values = points.map(point => point.value);
  const raw_min = values.length ? Math.min(...values) : 0;
  const raw_max = values.length ? Math.max(...values) : 1;
  const raw_span = raw_max - raw_min;
  const padding = raw_span > 0 ? raw_span * 0.08 : Math.max(Math.abs(raw_max), 1) * 0.08;
  const y_min = Number.isFinite(Number(options.y_min))
    ? Number(options.y_min)
    : Math.max(0, raw_min - padding);
  const y_max = Number.isFinite(Number(options.y_max))
    ? Number(options.y_max)
    : raw_max + padding;
  const y_span = Math.max(y_max - y_min, 1e-12);
  const plot_width = width - MARGIN.left - MARGIN.right;
  const plot_height = height - MARGIN.top - MARGIN.bottom;

  return {
    width,
    height,
    plot_width,
    plot_height,
    max_trial,
    y_min,
    y_max,
    x: trial => MARGIN.left + ((trial - 1) / Math.max(1, max_trial - 1)) * plot_width,
    y: value => MARGIN.top + ((y_max - value) / y_span) * plot_height,
  };
}

function buildLinePath(points, scale) {
  if (!points.length) {
    return "";
  }

  return points
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command} ${coordinate(scale.x(point.trial))} ${coordinate(scale.y(point.value))}`;
    })
    .join(" ");
}

function buildPointCircles(points, scale, color) {
  return points
    .map(point =>
      `<circle cx="${coordinate(scale.x(point.trial))}" cy="${coordinate(scale.y(point.value))}" r="2.5" fill="${color}"></circle>`
    )
    .join("");
}

function buildYAxisTicks(scale, count = 4) {
  const tick_count = Math.max(2, count);
  const ticks = [];
  for (let index = 0; index < tick_count; index++) {
    const fraction = index / (tick_count - 1);
    const value = scale.y_max - (scale.y_max - scale.y_min) * fraction;
    ticks.push({
      value,
      y: scale.y(value),
    });
  }
  return ticks;
}

function buildInfoGainSvg(max_mutual_info_history, realized_information_gain_history, options = {}) {
  const max_points = getFiniteTracePoints(max_mutual_info_history);
  const realized_points = getFiniteTracePoints(realized_information_gain_history);
  const scale = getInfoGainScale(max_points, realized_points, options);
  const bottom = MARGIN.top + scale.plot_height;
  const right = MARGIN.left + scale.plot_width;
  const max_path = buildLinePath(max_points, scale);
  const realized_path = buildLinePath(realized_points, scale);
  const y_ticks = buildYAxisTicks(scale, 4);
  const x_ticks = scale.max_trial === 1
    ? [{ label: "1", x: scale.x(1) }]
    : [
        { label: "1", x: scale.x(1) },
        { label: String(scale.max_trial), x: scale.x(scale.max_trial) },
      ];

  const grid_lines = y_ticks.map(tick =>
    `<line x1="${MARGIN.left}" y1="${coordinate(tick.y)}" x2="${coordinate(right)}" y2="${coordinate(tick.y)}" stroke="${COLORS.grid}" stroke-width="1"></line>` +
    `<text x="${MARGIN.left - 8}" y="${coordinate(tick.y + 3)}" text-anchor="end" fill="${COLORS.muted}" font-size="10">${formatTraceNumber(tick.value)}</text>`
  ).join("");
  const x_labels = x_ticks.map(tick =>
    `<text x="${coordinate(tick.x)}" y="${coordinate(bottom + 17)}" text-anchor="middle" fill="${COLORS.muted}" font-size="10">${tick.label}</text>`
  ).join("");
  const max_line = max_path
    ? `<path d="${max_path}" fill="none" stroke="${COLORS.max_mutual_info}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"></path>${buildPointCircles(max_points, scale, COLORS.max_mutual_info)}`
    : "";
  const realized_line = realized_path
    ? `<path d="${realized_path}" fill="none" stroke="${COLORS.realized_information_gain}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"></path>${buildPointCircles(realized_points, scale, COLORS.realized_information_gain)}`
    : "";

  return [
    `<svg viewBox="0 0 ${scale.width} ${scale.height}" role="img" aria-label="Information gain over trials" style="display:block;width:100%;height:auto;">`,
    `<rect x="0" y="0" width="${scale.width}" height="${scale.height}" fill="${COLORS.background}"></rect>`,
    grid_lines,
    `<line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${coordinate(bottom)}" stroke="${COLORS.axis}" stroke-width="1.2"></line>`,
    `<line x1="${MARGIN.left}" y1="${coordinate(bottom)}" x2="${coordinate(right)}" y2="${coordinate(bottom)}" stroke="${COLORS.axis}" stroke-width="1.2"></line>`,
    x_labels,
    `<text x="${coordinate((MARGIN.left + right) / 2)}" y="${coordinate(scale.height - 3)}" text-anchor="middle" fill="${COLORS.muted}" font-size="10">trial</text>`,
    `<text x="12" y="${coordinate((MARGIN.top + bottom) / 2)}" text-anchor="middle" fill="${COLORS.muted}" font-size="10" transform="rotate(-90 12 ${coordinate((MARGIN.top + bottom) / 2)})">nats</text>`,
    max_line,
    realized_line,
    `</svg>`,
  ].join("");
}

function buildLegendItem(color, label) {
  return [
    `<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;">`,
    `<span aria-hidden="true" style="display:inline-block;width:18px;height:0;border-top:2px solid ${color};"></span>`,
    `${label}`,
    `</span>`,
  ].join("");
}

function renderInfoGainDebugPanel(max_mutual_info_history, realized_information_gain_history, options = {}) {
  const max_points = getFiniteTracePoints(max_mutual_info_history);
  const realized_points = getFiniteTracePoints(realized_information_gain_history);
  const max_count = Array.isArray(max_mutual_info_history) ? max_mutual_info_history.length : 0;
  const realized_count = Array.isArray(realized_information_gain_history) ? realized_information_gain_history.length : 0;
  const trial_count = Math.max(max_count, realized_count);
  const latest_max = max_points.length ? max_points[max_points.length - 1].value : null;
  const latest_realized = realized_points.length ? realized_points[realized_points.length - 1].value : null;
  const subtitle = trial_count > 0
    ? `trial ${trial_count} | max MI ${formatTraceNumber(latest_max)} | realized IG ${formatTraceNumber(latest_realized)}`
    : "waiting for trials";
  const legend = [
    max_points.length ? buildLegendItem(COLORS.max_mutual_info, "Expected max MI") : "",
    realized_points.length ? buildLegendItem(COLORS.realized_information_gain, "Realized IG") : "",
  ].filter(Boolean).join("");

  return [
    `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:4px;">`,
    `<div>`,
    `<div style="font-weight:650;color:${COLORS.text};font-size:13px;line-height:1.2;">Information gain</div>`,
    `<div style="color:${COLORS.muted};font-size:11px;line-height:1.4;">${subtitle}</div>`,
    `</div>`,
    `</div>`,
    legend ? `<div style="display:flex;gap:12px;flex-wrap:wrap;color:${COLORS.muted};font-size:11px;margin:2px 0 4px;">${legend}</div>` : "",
    buildInfoGainSvg(max_mutual_info_history, realized_information_gain_history, options),
  ].join("");
}

function ensureInfoGainDebugPanel() {
  if (typeof document === "undefined" || !document.body) {
    return null;
  }

  let panel = document.getElementById(PANEL_ID);
  if (panel) {
    return panel;
  }

  panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.setAttribute("aria-live", "polite");
  panel.style.cssText = [
    "position:fixed",
    "right:14px",
    "bottom:14px",
    "width:380px",
    "max-width:calc(100vw - 28px)",
    "padding:10px 12px 12px",
    "box-sizing:border-box",
    "background:rgba(255,255,255,0.97)",
    "border:1px solid #d1d5db",
    "border-radius:8px",
    "box-shadow:0 10px 26px rgba(17,24,39,0.16)",
    "color:#111827",
    "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "z-index:9999",
  ].join(";");
  document.body.appendChild(panel);
  return panel;
}

function updateInfoGainDebugPanel(max_mutual_info_history, realized_information_gain_history, options = {}) {
  const panel = ensureInfoGainDebugPanel();
  if (!panel) {
    return null;
  }

  panel.innerHTML = renderInfoGainDebugPanel(
    max_mutual_info_history,
    realized_information_gain_history,
    options,
  );
  return panel;
}

export {
  buildInfoGainSvg,
  buildLinePath,
  getFiniteTracePoints,
  getInfoGainScale,
  renderInfoGainDebugPanel,
  updateInfoGainDebugPanel,
};
