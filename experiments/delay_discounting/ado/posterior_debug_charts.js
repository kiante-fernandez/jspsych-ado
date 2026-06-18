import asciichart from "./asciichart.js";

const DEFAULT_BINS = 32;
const DEFAULT_HEIGHT = 8;

const PARAM_SCALES = {
  k: {
    axis_label: "log10(k)",
    transform: value => value > 0 ? Math.log10(value) : NaN,
    format_range: (min, max) =>
      `log10(k) ${formatEstimate(min)} to ${formatEstimate(max)} (k ${formatEstimate(10 ** min)} to ${formatEstimate(10 ** max)})`,
  },
  tau: {
    axis_label: "tau",
    transform: value => value,
    format_range: (min, max) => `tau ${formatEstimate(min)} to ${formatEstimate(max)}`,
  },
};

function formatEstimate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "NA";
  }
  const abs = Math.abs(number);
  if (abs > 0 && (abs < 0.001 || abs >= 10000)) {
    return number.toExponential(3);
  }
  return number.toPrecision(4);
}

function clampInteger(value, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.max(min, Math.min(max, number));
}

function getTransformedValues(draws, param, transform) {
  if (!Array.isArray(draws)) {
    return [];
  }
  const values = [];
  for (const draw of draws) {
    if (!draw || !(param in draw)) {
      continue;
    }
    const value = transform(Number(draw[param]));
    if (Number.isFinite(value)) {
      values.push(value);
    }
  }
  return values;
}

function inferPosteriorParams(draws) {
  if (!Array.isArray(draws)) {
    return [];
  }

  const seen = new Set();
  const params = [];
  for (const draw of draws) {
    if (!draw) {
      continue;
    }
    for (const param of Object.keys(draw)) {
      if (seen.has(param) || !Number.isFinite(Number(draw[param]))) {
        continue;
      }
      seen.add(param);
      params.push(param);
    }
  }
  return params;
}

function buildHistogram(values, bin_count = DEFAULT_BINS) {
  const bins = clampInteger(bin_count, 4, 80);
  const counts = new Array(bins).fill(0);
  const finite_values = values.map(Number).filter(Number.isFinite);

  if (finite_values.length === 0) {
    return { counts, min: null, max: null, n: 0 };
  }

  const min = Math.min(...finite_values);
  const max = Math.max(...finite_values);
  if (min === max) {
    counts[Math.floor(bins / 2)] = finite_values.length;
    return { counts, min, max, n: finite_values.length };
  }

  const width = (max - min) / bins;
  for (const value of finite_values) {
    const index = Math.max(0, Math.min(bins - 1, Math.floor((value - min) / width)));
    counts[index]++;
  }

  return { counts, min, max, n: finite_values.length };
}

function formatPosteriorDrawChart(draws, param, options = {}) {
  const scale = PARAM_SCALES[param] || {
    axis_label: param,
    transform: value => value,
    format_range: (min, max) => `${param} ${formatEstimate(min)} to ${formatEstimate(max)}`,
  };
  const values = getTransformedValues(draws, param, scale.transform);
  if (values.length === 0) {
    return "";
  }

  const histogram = buildHistogram(values, options.bins || DEFAULT_BINS);
  const chart = asciichart.plot(histogram.counts, {
    height: options.height || DEFAULT_HEIGHT,
    min: 0,
    format: value => String(Math.round(value)).padStart(5),
  });

  return [
    `${param} (${scale.axis_label}; n=${histogram.n})`,
    chart,
    `x range: ${scale.format_range(histogram.min, histogram.max)}`,
  ].join("\n");
}

function formatPosteriorDrawCharts(draws, params = null, options = {}) {
  const chart_params = Array.isArray(params) ? params : inferPosteriorParams(draws);
  const charts = chart_params
    .map(param => formatPosteriorDrawChart(draws, param, options))
    .filter(Boolean);

  if (charts.length === 0) {
    return "";
  }

  return [
    "Posterior draw histograms (asciichart):",
    ...charts,
  ].join("\n\n");
}

export {
  buildHistogram,
  inferPosteriorParams,
  formatPosteriorDrawChart,
  formatPosteriorDrawCharts,
};
