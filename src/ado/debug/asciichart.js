// Local browser-safe subset of the asciichart plot(series, config) API.

const DEFAULT_HEIGHT = 10;
const DEFAULT_PADDING = "       ";
const PLOT_POINT = "─";
const CONNECTORS = {
  vertical: "│",
  rising_top: "╭",
  rising_bottom: "╯",
  falling_top: "╮",
  falling_bottom: "╰",
};
const JUNCTION_CONNECTORS = {
  vertical: "│",
  from: "┤",
  to: "├",
};

function coerceNumericSeries(series) {
  if (!Array.isArray(series)) {
    return [];
  }
  const values = Array.isArray(series[0]) ? series[0] : series;
  return values.map(Number).filter(Number.isFinite);
}

function defaultFormat(value, _index, padding = DEFAULT_PADDING) {
  return (padding + value.toFixed(2)).slice(-padding.length);
}

function drawVerticalConnector(canvas, x, from_row, to_row, style = "corner") {
  if (from_row === to_row) {
    canvas[from_row][x] = PLOT_POINT;
    return;
  }

  if (style === "junction") {
    const top = Math.min(from_row, to_row);
    const bottom = Math.max(from_row, to_row);
    for (let row = top + 1; row < bottom; row++) {
      canvas[row][x] = JUNCTION_CONNECTORS.vertical;
    }
    canvas[from_row][x] = JUNCTION_CONNECTORS.from;
    canvas[to_row][x] = JUNCTION_CONNECTORS.to;
    return;
  }

  const top = Math.min(from_row, to_row);
  const bottom = Math.max(from_row, to_row);
  for (let row = top + 1; row < bottom; row++) {
    canvas[row][x] = CONNECTORS.vertical;
  }

  if (to_row < from_row) {
    canvas[to_row][x] = CONNECTORS.rising_top;
    canvas[from_row][x] = CONNECTORS.rising_bottom;
  } else {
    canvas[from_row][x] = CONNECTORS.falling_top;
    canvas[to_row][x] = CONNECTORS.falling_bottom;
  }
}

/**
 * Render a numeric series as a multi-line ASCII line chart (a browser-safe subset of
 * the asciichart API).
 *
 * @param {number[]} series - The y-values to plot.
 * @param {Object} [config]
 * @param {number} [config.height] - Number of rows; the y-axis is quantized to this.
 * @param {number} [config.min] - Y-axis minimum (defaults to the series min).
 * @param {number} [config.max] - Y-axis maximum (defaults to the series max).
 * @param {Function} [config.format] - (value, index, padding) => string; formats the axis labels.
 * @param {string} [config.padding] - Left-pad template for axis labels.
 * @param {string} [config.connector_style] - "junction" or "corner" line joins.
 * @returns {string} The chart as a multi-line string.
 */
function plot(series, config = {}) {
  const values = coerceNumericSeries(series);
  if (values.length === 0) {
    return "";
  }

  const height = Math.max(1, Math.floor(Number(config.height) || DEFAULT_HEIGHT));
  const min = Number.isFinite(Number(config.min)) ? Number(config.min) : Math.min(...values);
  const max = Number.isFinite(Number(config.max)) ? Number(config.max) : Math.max(...values);
  const spread = max - min;
  const range = spread === 0 ? 1 : spread;
  const format = typeof config.format === "function" ? config.format : defaultFormat;
  const padding = typeof config.padding === "string" ? config.padding : DEFAULT_PADDING;
  const connector_style = config.connector_style === "junction" ? "junction" : "corner";
  const canvas = Array.from({ length: height + 1 }, () => Array(values.length + 1).fill(" "));
  const rows = values.map((value) => {
    const normalized = spread === 0 ? 0.5 : (value - min) / range;
    return Math.max(0, Math.min(height, Math.round(height - normalized * height)));
  });

  canvas[rows[0]][0] = PLOT_POINT;

  for (let i = 0; i < rows.length - 1; i++) {
    drawVerticalConnector(canvas, i + 1, rows[i], rows[i + 1], connector_style);
  }
  if (rows.length > 1) {
    canvas[rows[rows.length - 1]][rows.length] = PLOT_POINT;
  }

  return canvas
    .map((row, index) => {
      const value = max - (range * index) / height;
      return `${format(value, index, padding)} | ${row.join("")}`;
    })
    .join("\n");
}

export { plot };
export default { plot };
