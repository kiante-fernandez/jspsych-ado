// Information-gain trace panel for the ADO timeline (DEBUG ONLY, model-agnostic).
// Renders a fixed bottom-corner SVG panel plotting two per-trial series as inline SVG —
// the selected design's mutual information (blue) and the realized information gain (red)
// — so you can watch expected-vs-realized information over a run. The timeline
// creates/updates/removes it when run_context.debug is set; never shown to participants.
// (Contrast the sibling debug modules: posterior_debug_charts.js draws ASCII histograms,
// posterior_convergence_charts.js draws SVG posterior trajectories + the debrief.)

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
  selected_design_mi: "#2563eb",
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
    .filter((point) => !point.missing && Number.isFinite(point.value))
    .map((point) => ({
      trial: point.trial,
      value: point.value,
    }));
}

function getInfoGainScale(selected_points, realized_points, options = {}) {
  const width = Number.isFinite(Number(options.width)) ? Number(options.width) : SVG_WIDTH;
  const height = Number.isFinite(Number(options.height)) ? Number(options.height) : SVG_HEIGHT;
  const points = [...selected_points, ...realized_points];
  const max_trial = Math.max(1, ...points.map((point) => point.trial));
  const values = points.map((point) => point.value);
  const raw_min = values.length ? Math.min(...values) : 0;
  const raw_max = values.length ? Math.max(...values) : 1;
  const raw_span = raw_max - raw_min;
  const padding = raw_span > 0 ? raw_span * 0.08 : Math.max(Math.abs(raw_max), 1) * 0.08;
  const y_min = Number.isFinite(Number(options.y_min))
    ? Number(options.y_min)
    : Math.max(0, raw_min - padding);
  const y_max = Number.isFinite(Number(options.y_max)) ? Number(options.y_max) : raw_max + padding;
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
    x: (trial) => MARGIN.left + ((trial - 1) / Math.max(1, max_trial - 1)) * plot_width,
    y: (value) => MARGIN.top + ((y_max - value) / y_span) * plot_height,
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
    .map(
      (point) =>
        `<circle cx="${coordinate(scale.x(point.trial))}" cy="${coordinate(scale.y(point.value))}" r="2.5" fill="${color}"></circle>`,
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

function buildInfoGainSvg(
  selected_design_mi_history,
  realized_information_gain_history,
  options = {},
) {
  const selected_points = getFiniteTracePoints(selected_design_mi_history);
  const realized_points = getFiniteTracePoints(realized_information_gain_history);
  const scale = getInfoGainScale(selected_points, realized_points, options);
  const bottom = MARGIN.top + scale.plot_height;
  const right = MARGIN.left + scale.plot_width;
  const selected_path = buildLinePath(selected_points, scale);
  const realized_path = buildLinePath(realized_points, scale);
  const y_ticks = buildYAxisTicks(scale, 4);
  const x_ticks =
    scale.max_trial === 1
      ? [{ label: "1", x: scale.x(1) }]
      : [
          { label: "1", x: scale.x(1) },
          { label: String(scale.max_trial), x: scale.x(scale.max_trial) },
        ];

  const grid_lines = y_ticks
    .map(
      (tick) =>
        `<line x1="${MARGIN.left}" y1="${coordinate(tick.y)}" x2="${coordinate(right)}" y2="${coordinate(tick.y)}" stroke="${COLORS.grid}" stroke-width="1"></line>` +
        `<text x="${MARGIN.left - 8}" y="${coordinate(tick.y + 3)}" text-anchor="end" fill="${COLORS.muted}" font-size="10">${formatTraceNumber(tick.value)}</text>`,
    )
    .join("");
  const x_labels = x_ticks
    .map(
      (tick) =>
        `<text x="${coordinate(tick.x)}" y="${coordinate(bottom + 17)}" text-anchor="middle" fill="${COLORS.muted}" font-size="10">${tick.label}</text>`,
    )
    .join("");
  const selected_line = selected_path
    ? `<path d="${selected_path}" fill="none" stroke="${COLORS.selected_design_mi}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"></path>${buildPointCircles(selected_points, scale, COLORS.selected_design_mi)}`
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
    selected_line,
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

/**
 * Build the panel's inner HTML: the two-series SVG trace (selected-design MI in blue,
 * realized information gain in red) with title, subtitle, and legend.
 *
 * @param {Array<?number>} selected_design_mi_history - Per-trial selected-design MI (null where unavailable).
 * @param {Array<?number>} realized_information_gain_history - Per-trial realized IG (null where unavailable).
 * @param {Object} [options] - {width, height, y_min, y_max} overrides.
 * @returns {string} HTML for the panel body.
 */
function renderInfoGainDebugPanel(
  selected_design_mi_history,
  realized_information_gain_history,
  options = {},
) {
  const selected_points = getFiniteTracePoints(selected_design_mi_history);
  const realized_points = getFiniteTracePoints(realized_information_gain_history);
  const selected_count = Array.isArray(selected_design_mi_history)
    ? selected_design_mi_history.length
    : 0;
  const realized_count = Array.isArray(realized_information_gain_history)
    ? realized_information_gain_history.length
    : 0;
  const trial_count = Math.max(selected_count, realized_count);
  const latest_selected = selected_points.length
    ? selected_points[selected_points.length - 1].value
    : null;
  const latest_realized = realized_points.length
    ? realized_points[realized_points.length - 1].value
    : null;
  const subtitle_parts = [`trial ${trial_count}`];
  if (selected_points.length) {
    subtitle_parts.push(`selected design MI ${formatTraceNumber(latest_selected)}`);
  }
  if (realized_points.length) {
    subtitle_parts.push(`realized IG ${formatTraceNumber(latest_realized)}`);
  }
  const subtitle = trial_count > 0 ? subtitle_parts.join(" | ") : "waiting for trials";
  const legend = [
    selected_points.length ? buildLegendItem(COLORS.selected_design_mi, "Selected design MI") : "",
    realized_points.length ? buildLegendItem(COLORS.realized_information_gain, "Realized IG") : "",
  ]
    .filter(Boolean)
    .join("");

  return [
    `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:4px;">`,
    `<div>`,
    `<div style="font-weight:650;color:${COLORS.text};font-size:13px;line-height:1.2;">Information gain</div>`,
    `<div style="color:${COLORS.muted};font-size:11px;line-height:1.4;">${subtitle}</div>`,
    `<div style="color:${COLORS.muted};font-size:10px;line-height:1.35;margin-top:2px;">Blue: expected learning from the selected design. Red: actual posterior update after the response.</div>`,
    `</div>`,
    `</div>`,
    legend
      ? `<div style="display:flex;gap:12px;flex-wrap:wrap;color:${COLORS.muted};font-size:11px;margin:2px 0 4px;">${legend}</div>`
      : "",
    buildInfoGainSvg(selected_design_mi_history, realized_information_gain_history, options),
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
    "top:14px",
    "width:380px",
    "max-width:calc(100vw - 28px)",
    "max-height:calc(100vh - 28px)",
    "overflow:auto",
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

/**
 * Create the panel if needed and (re)render it from the latest histories. No-op when
 * neither series has a finite point yet (or there is no DOM).
 *
 * @param {Array<?number>} selected_design_mi_history
 * @param {Array<?number>} realized_information_gain_history
 * @param {Object} [options] - {width, height, y_min, y_max} overrides.
 * @returns {?HTMLElement} The panel element, or null if nothing to draw.
 */
function updateInfoGainDebugPanel(
  selected_design_mi_history,
  realized_information_gain_history,
  options = {},
) {
  const selected_points = getFiniteTracePoints(selected_design_mi_history);
  const realized_points = getFiniteTracePoints(realized_information_gain_history);
  if (!selected_points.length && !realized_points.length) {
    return null;
  }

  const panel = ensureInfoGainDebugPanel();
  if (!panel) {
    return null;
  }

  panel.innerHTML = renderInfoGainDebugPanel(
    selected_design_mi_history,
    realized_information_gain_history,
    options,
  );
  return panel;
}

/**
 * Remove the info-gain debug panel from the DOM (run teardown). Safe to call when the
 * panel was never created or there is no document.
 */
function removeInfoGainDebugPanel() {
  if (typeof document === "undefined" || !document.body) {
    return;
  }

  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.remove();
  }
}

export {
  buildInfoGainSvg,
  buildLinePath,
  getFiniteTracePoints,
  getInfoGainScale,
  removeInfoGainDebugPanel,
  renderInfoGainDebugPanel,
  updateInfoGainDebugPanel,
};
