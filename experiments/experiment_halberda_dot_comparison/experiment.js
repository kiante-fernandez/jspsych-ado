// ------------------------------------------------------------
// Halberda, Mazzocco, & Feigenson (2008)-style dot comparison
// Core idea: briefly show intermixed blue/yellow dots and ask
// which color is more numerous.
// ------------------------------------------------------------

const jsPsych = initJsPsych({
  on_finish: function() {
    renderResults();
  }
});

// ----------------------
// Experiment parameters
// ----------------------
const CANVAS_W = 800;
const CANVAS_H = 600;
const STIM_MS = 200;     // original child task used a very brief display
const FIXATION_MS = 250;
const RESPONSE_KEYS = ['b', 'y']; // b = blue more, y = yellow more

// Original-style ratios from the paper: 1:2, 3:4, 5:6, 7:8.
// For adult versions, add harder ratios like 9:10, 11:12.
const RATIOS = [
  {small: 1, large: 2, label: '1:2'},
  {small: 3, large: 4, label: '3:4'},
  {small: 5, large: 6, label: '5:6'},
  {small: 7, large: 8, label: '7:8'}
];

const BASE_LARGE_COUNTS = [8, 12, 16]; // keeps counts in a child-friendly range
const N_REPS_PER_RATIO = 10;           // 4 ratios x 10 = 40 test trials

const SESSION_ID = makeSessionId();
const PARTICIPANT_ID = getUrlParam('participant') || getUrlParam('participant_id') || 'anonymous';

jsPsych.data.addProperties({
  participant_id: PARTICIPANT_ID,
  session_id: SESSION_ID,
  task: 'halberda_dot_comparison',
  task_version: '1.1.0',
  started_at: new Date().toISOString()
});

// ----------------------
// Utility functions
// ----------------------
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getUrlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function makeSessionId() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}_${random}`;
}

function distance(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function generateDotPositions(n, existingDots, minDist = 22) {
  const dots = [];
  let attempts = 0;

  while (dots.length < n && attempts < 10000) {
    attempts++;
    const r = 6 + Math.random() * 10;
    const x = 70 + Math.random() * (CANVAS_W - 140);
    const y = 70 + Math.random() * (CANVAS_H - 140);

    const candidate = {x, y, r};
    const allDots = existingDots.concat(dots);
    const ok = allDots.every(d => distance(x, y, d.x, d.y) > minDist + r + d.r);

    if (ok) dots.push(candidate);
  }
  return dots;
}

// Visual-cue control mode:
// 1. size_control: both colors have similar average dot size.
// 2. area_control: total blue area and total yellow area are approximately matched.
function makeDots(nBlue, nYellow, controlMode) {
  let blueDots = [];
  let yellowDots = [];

  if (controlMode === 'size_control') {
    blueDots = generateDotPositions(nBlue, []);
    yellowDots = generateDotPositions(nYellow, blueDots);
  }

  if (controlMode === 'area_control') {
    // First generate positions. Then set radii so total area is approximately equal.
    blueDots = generateDotPositions(nBlue, []);
    yellowDots = generateDotPositions(nYellow, blueDots);

    const targetTotalArea = 2800;
    const blueR = Math.sqrt(targetTotalArea / (Math.PI * nBlue));
    const yellowR = Math.sqrt(targetTotalArea / (Math.PI * nYellow));

    blueDots = blueDots.map(d => ({...d, r: blueR * (0.85 + Math.random() * 0.30)}));
    yellowDots = yellowDots.map(d => ({...d, r: yellowR * (0.85 + Math.random() * 0.30)}));
  }

  return {blueDots, yellowDots};
}

function drawTextCentered(ctx, text, y, font = '28px Arial') {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#222';
  ctx.fillText(text, CANVAS_W / 2, y);
}

function drawFixation(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2 - 15, CANVAS_H / 2);
  ctx.lineTo(CANVAS_W / 2 + 15, CANVAS_H / 2);
  ctx.moveTo(CANVAS_W / 2, CANVAS_H / 2 - 15);
  ctx.lineTo(CANVAS_W / 2, CANVAS_H / 2 + 15);
  ctx.stroke();
}

function drawDots(canvas, trial) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const allDots = shuffle(
    trial.blueDots.map(d => ({...d, color: 'blue'})).concat(
      trial.yellowDots.map(d => ({...d, color: 'yellow'}))
    )
  );

  allDots.forEach(d => {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, 2 * Math.PI);
    ctx.fillStyle = d.color === 'blue' ? '#1f77b4' : '#f2c230';
    ctx.fill();
  });
}

function drawResponsePrompt(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTextCentered(ctx, 'Which color had more dots?', 230, '30px Arial');
  drawTextCentered(ctx, 'Press B for BLUE     Press Y for YELLOW', 310, '26px Arial');
}

function drawInstructions(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTextCentered(ctx, 'Dot Comparison Task', 130, '34px Arial');
  drawTextCentered(ctx, 'You will briefly see blue and yellow dots.', 210, '24px Arial');
  drawTextCentered(ctx, 'Your job is to decide which color had MORE dots.', 250, '24px Arial');
  drawTextCentered(ctx, 'Press B if there were more BLUE dots.', 310, '24px Arial');
  drawTextCentered(ctx, 'Press Y if there were more YELLOW dots.', 350, '24px Arial');
  drawTextCentered(ctx, 'The display is very fast, so do not try to count.', 410, '24px Arial');
  drawTextCentered(ctx, 'Press SPACE to begin.', 500, '24px Arial');
}

function getResponseRows() {
  return jsPsych.data
    .get()
    .filter({block: 'response'})
    .values()
    .map(row => ({
      participant_id: row.participant_id,
      session_id: row.session_id,
      task: row.task,
      task_version: row.task_version,
      started_at: row.started_at,
      trial_index: row.trial_index,
      ratio: row.ratio,
      ratio_value: Number(row.ratio_value),
      ratio_big_small: 1 / Number(row.ratio_value),
      n_blue: row.n_blue,
      n_yellow: row.n_yellow,
      more_color: row.more_color,
      correct_key: row.correct_key,
      response: row.response,
      response_color: row.response_color,
      correct: Boolean(row.correct),
      rt: row.rt,
      control_mode: row.control_mode
    }));
}

function summarizeByRatio(rows) {
  return RATIOS.map(ratio => {
    const ratioRows = rows.filter(row => row.ratio === ratio.label);
    const n = ratioRows.length;
    const correctN = ratioRows.filter(row => row.correct).length;
    return {
      ratio: ratio.label,
      ratio_value: ratio.small / ratio.large,
      ratio_big_small: ratio.large / ratio.small,
      n_trials: n,
      n_correct: correctN,
      accuracy: n ? correctN / n : null,
      mean_rt: mean(ratioRows.map(row => row.rt).filter(Number.isFinite))
    };
  });
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function normCDF(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function predictedAccuracy(row, w) {
  const nLarge = Math.max(row.n_blue, row.n_yellow);
  const nSmall = Math.min(row.n_blue, row.n_yellow);
  const signal = (nLarge - nSmall) / (w * Math.sqrt(nLarge ** 2 + nSmall ** 2));
  return clamp(normCDF(signal), 0.001, 0.999);
}

function negativeLogLikelihood(rows, w) {
  return rows.reduce((total, row) => {
    const p = predictedAccuracy(row, w);
    return total - Math.log(row.correct ? p : 1 - p);
  }, 0);
}

function fitWeberFraction(rows) {
  if (!rows.length) return null;

  let bestW = 0.30;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let w = 0.05; w <= 1.2; w += 0.001) {
    const score = negativeLogLikelihood(rows, w);
    if (score < bestScore) {
      bestScore = score;
      bestW = w;
    }
  }

  return bestW;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeFilenamePart(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'anonymous';
}

function rowsToCsv(rows) {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const header = columns.join(',');
  const body = rows.map(row => columns.map(column => csvEscape(row[column])).join(','));
  return [header].concat(body).join('\n');
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function drawResultsPlot(canvas, summary, w) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const margin = {top: 44, right: 34, bottom: 72, left: 76};
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const minX = 1;
  const maxX = 2.05;
  const minY = 0.5;
  const maxY = 1.0;
  const points = summary.filter(row => row.n_trials > 0 && row.accuracy !== null);

  function xScale(value) {
    return margin.left + ((value - minX) / (maxX - minX)) * plotW;
  }

  function yScale(value) {
    return margin.top + (1 - ((value - minY) / (maxY - minY))) * plotH;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  [0.5, 0.6, 0.7, 0.8, 0.9, 1.0].forEach(tick => {
    const y = yScale(tick);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
  });

  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, height - margin.bottom);
  ctx.lineTo(width - margin.right, height - margin.bottom);
  ctx.stroke();

  ctx.fillStyle = '#111827';
  ctx.font = '16px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  [1, 1.25, 1.5, 1.75, 2].forEach(tick => {
    const x = xScale(tick);
    ctx.fillText(String(tick), x, height - margin.bottom + 12);
  });

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  [0.5, 0.6, 0.7, 0.8, 0.9, 1.0].forEach(tick => {
    ctx.fillText(String(Math.round(tick * 100)), margin.left - 12, yScale(tick));
  });

  ctx.font = '20px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Ratio (bigger set / smaller set)', margin.left + plotW / 2, height - 34);

  ctx.save();
  ctx.translate(24, margin.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Percent correct', 0, 0);
  ctx.restore();

  ctx.font = '22px Arial';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('Dot comparison performance', margin.left, 12);

  if (w) {
    ctx.strokeStyle = '#e7812b';
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const ratio = minX + (i / 100) * (maxX - minX);
      const nSmall = 100;
      const nLarge = nSmall * ratio;
      const y = normCDF((nLarge - nSmall) / (w * Math.sqrt(nLarge ** 2 + nSmall ** 2)));
      const xPx = xScale(ratio);
      const yPx = yScale(y);
      if (i === 0) ctx.moveTo(xPx, yPx);
      else ctx.lineTo(xPx, yPx);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  points.forEach(point => {
    const x = xScale(point.ratio_big_small);
    const y = yScale(point.accuracy);
    const se = point.n_trials ? Math.sqrt(point.accuracy * (1 - point.accuracy) / point.n_trials) : 0;
    const yTop = yScale(clamp(point.accuracy + se, minY, maxY));
    const yBottom = yScale(clamp(point.accuracy - se, minY, maxY));

    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, yTop);
    ctx.lineTo(x, yBottom);
    ctx.moveTo(x - 7, yTop);
    ctx.lineTo(x + 7, yTop);
    ctx.moveTo(x - 7, yBottom);
    ctx.lineTo(x + 7, yBottom);
    ctx.stroke();

    ctx.fillStyle = '#2f96cc';
    ctx.strokeStyle = '#0f4663';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  });

  ctx.font = '15px Arial';
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const legendX = width - margin.right - 230;
  const legendY = margin.top + 22;
  ctx.fillStyle = '#2f96cc';
  ctx.beginPath();
  ctx.arc(legendX, legendY, 7, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = '#111827';
  ctx.fillText('Observed accuracy', legendX + 18, legendY);

  ctx.strokeStyle = '#e7812b';
  ctx.lineWidth = 3;
  ctx.setLineDash([9, 7]);
  ctx.beginPath();
  ctx.moveTo(legendX - 8, legendY + 28);
  ctx.lineTo(legendX + 28, legendY + 28);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#111827';
  ctx.fillText(`ANS model${w ? ` (w = ${w.toFixed(3)})` : ''}`, legendX + 38, legendY + 28);
}

function renderResults() {
  const rows = getResponseRows();
  const summary = summarizeByRatio(rows);
  const w = fitWeberFraction(rows);
  const rawCsv = rowsToCsv(rows);
  const summaryRows = summary.map(row => ({
    ...row,
    accuracy_percent: row.accuracy === null ? null : row.accuracy * 100,
    fitted_weber_fraction: w
  }));
  const summaryCsv = rowsToCsv(summaryRows);
  const json = JSON.stringify({
    participant_id: PARTICIPANT_ID,
    session_id: SESSION_ID,
    fitted_weber_fraction: w,
    summary,
    trials: rows
  }, null, 2);
  const safeParticipantId = escapeHtml(PARTICIPANT_ID);
  const filenameBase = `halberda_dot_${safeFilenamePart(PARTICIPANT_ID)}_${SESSION_ID}`;

  document.body.innerHTML = `
    <main class="results-page">
      <section class="results-header">
        <div>
          <h1>Dot Comparison Results</h1>
          <p>${rows.length} response trials recorded for participant ${safeParticipantId}.</p>
        </div>
        <div class="results-stat">
          <span>Fitted w</span>
          <strong>${w ? w.toFixed(3) : 'n/a'}</strong>
        </div>
      </section>

      <section class="results-actions">
        <button id="download-raw">Download raw CSV</button>
        <button id="download-summary">Download summary CSV</button>
        <button id="download-json">Download JSON</button>
        <button id="download-plot">Download plot PNG</button>
      </section>

      <section class="plot-wrap">
        <canvas id="results-plot" width="900" height="620"></canvas>
      </section>

      <section class="summary-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ratio</th>
              <th>Big/small</th>
              <th>Trials</th>
              <th>Correct</th>
              <th>Accuracy</th>
              <th>Mean RT</th>
            </tr>
          </thead>
          <tbody>
            ${summary.map(row => `
              <tr>
                <td>${row.ratio}</td>
                <td>${row.ratio_big_small.toFixed(2)}</td>
                <td>${row.n_trials}</td>
                <td>${row.n_correct}</td>
                <td>${row.accuracy === null ? 'n/a' : `${Math.round(row.accuracy * 100)}%`}</td>
                <td>${row.mean_rt === null ? 'n/a' : `${Math.round(row.mean_rt)} ms`}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </section>
    </main>
  `;

  const plotCanvas = document.getElementById('results-plot');
  drawResultsPlot(plotCanvas, summary, w);

  document.getElementById('download-raw').addEventListener('click', () => {
    downloadText(`${filenameBase}_raw.csv`, rawCsv, 'text/csv');
  });
  document.getElementById('download-summary').addEventListener('click', () => {
    downloadText(`${filenameBase}_summary.csv`, summaryCsv, 'text/csv');
  });
  document.getElementById('download-json').addEventListener('click', () => {
    downloadText(`${filenameBase}.json`, json, 'application/json');
  });
  document.getElementById('download-plot').addEventListener('click', () => {
    downloadCanvas(plotCanvas, `${filenameBase}_figure1b_style.png`);
  });

  downloadText(`${filenameBase}_raw.csv`, rawCsv, 'text/csv');
}

// ----------------------
// Generate trials
// ----------------------
function makeTrialList() {
  const trials = [];

  RATIOS.forEach(ratio => {
    for (let rep = 0; rep < N_REPS_PER_RATIO; rep++) {
      const largeCount = randomChoice(BASE_LARGE_COUNTS);
      const smallCount = Math.round(largeCount * ratio.small / ratio.large);
      const moreColor = Math.random() < 0.5 ? 'blue' : 'yellow';
      const controlMode = Math.random() < 0.5 ? 'size_control' : 'area_control';

      const nBlue = moreColor === 'blue' ? largeCount : smallCount;
      const nYellow = moreColor === 'yellow' ? largeCount : smallCount;
      const dots = makeDots(nBlue, nYellow, controlMode);

      trials.push({
        ratio: ratio.label,
        ratio_value: smallCount / largeCount,
        n_blue: nBlue,
        n_yellow: nYellow,
        more_color: moreColor,
        correct_key: moreColor === 'blue' ? 'b' : 'y',
        control_mode: controlMode,
        blueDots: dots.blueDots,
        yellowDots: dots.yellowDots
      });
    }
  });

  return shuffle(trials);
}

const dotTrials = makeTrialList();

// ----------------------
// jsPsych timeline
// ----------------------
const timeline = [];

timeline.push({
  type: jsPsychCanvasKeyboardResponse,
  canvas_size: [CANVAS_H, CANVAS_W],
  stimulus: drawInstructions,
  choices: [' '],
  data: {block: 'instructions'}
});

dotTrials.forEach((trial, i) => {
  timeline.push({
    type: jsPsychCanvasKeyboardResponse,
    canvas_size: [CANVAS_H, CANVAS_W],
    stimulus: drawFixation,
    choices: 'NO_KEYS',
    trial_duration: FIXATION_MS,
    data: {block: 'fixation', trial_index: i + 1}
  });

  timeline.push({
    type: jsPsychCanvasKeyboardResponse,
    canvas_size: [CANVAS_H, CANVAS_W],
    stimulus: function(canvas) { drawDots(canvas, trial); },
    choices: 'NO_KEYS',
    trial_duration: STIM_MS,
    data: {
      block: 'dot_display',
      trial_index: i + 1,
      ratio: trial.ratio,
      ratio_value: trial.ratio_value,
      n_blue: trial.n_blue,
      n_yellow: trial.n_yellow,
      more_color: trial.more_color,
      control_mode: trial.control_mode
    }
  });

  timeline.push({
    type: jsPsychCanvasKeyboardResponse,
    canvas_size: [CANVAS_H, CANVAS_W],
    stimulus: drawResponsePrompt,
    choices: RESPONSE_KEYS,
    data: {
      block: 'response',
      trial_index: i + 1,
      ratio: trial.ratio,
      ratio_value: trial.ratio_value,
      n_blue: trial.n_blue,
      n_yellow: trial.n_yellow,
      more_color: trial.more_color,
      correct_key: trial.correct_key,
      control_mode: trial.control_mode
    },
    on_finish: function(data) {
      data.correct = data.response === data.correct_key;
      data.response_color = data.response === 'b' ? 'blue' : 'yellow';
    }
  });
});

jsPsych.run(timeline);
