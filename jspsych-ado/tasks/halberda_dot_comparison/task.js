import {
  canvasFrame,
  canvasResponse,
} from "../../ado/ado_timeline.js";

const CANVAS_W = 800;
const CANVAS_H = 600;
const CANVAS_SIZE = [CANVAS_H, CANVAS_W];
const FIXATION_MS = 250;
const STIM_MS = 200;
const RESPONSE_KEYS = ["b", "y"];
const response_labels = { 0: "incorrect", 1: "correct" };

const RATIOS = [
  { small: 1, large: 2, label: "1:2" },
  { small: 3, large: 4, label: "3:4" },
  { small: 5, large: 6, label: "5:6" },
  { small: 7, large: 8, label: "7:8" },
  { small: 9, large: 10, label: "9:10" },
  { small: 11, large: 12, label: "11:12" },
];

const BASE_LARGE_COUNTS = [8, 12, 16, 20, 24, 30];
const CONTROL_MODES = ["size_control", "area_control"];

function makeDotComparisonDesigns({
  ratios = RATIOS,
  large_counts = BASE_LARGE_COUNTS,
  control_modes = CONTROL_MODES,
} = {}) {
  const designs = [];
  for (const ratio of ratios) {
    for (const large_count of large_counts) {
      const small_count = Math.max(1, Math.round(large_count * ratio.small / ratio.large));
      if (small_count >= large_count) {
        continue;
      }
      for (const control_mode of control_modes) {
        designs.push(makeDesign({
          n_blue: large_count,
          n_yellow: small_count,
          ratio,
          control_mode,
        }));
        designs.push(makeDesign({
          n_blue: small_count,
          n_yellow: large_count,
          ratio,
          control_mode,
        }));
      }
    }
  }
  return designs;
}

function makeDesign({ n_blue, n_yellow, ratio, control_mode }) {
  const n_large = Math.max(n_blue, n_yellow);
  const n_small = Math.min(n_blue, n_yellow);
  return {
    n_blue,
    n_yellow,
    n_large,
    n_small,
    ratio: ratio.label,
    ratio_value: n_small / n_large,
    ratio_big_small: n_large / n_small,
    more_color: n_blue > n_yellow ? "blue" : "yellow",
    correct_key: n_blue > n_yellow ? "b" : "y",
    control_mode,
  };
}

function distance(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function generateDotPositions(n, existing_dots, min_dist = 22) {
  const dots = [];
  let attempts = 0;

  while (dots.length < n && attempts < 10000) {
    attempts++;
    const r = 6 + Math.random() * 10;
    const x = 70 + Math.random() * (CANVAS_W - 140);
    const y = 70 + Math.random() * (CANVAS_H - 140);
    const candidate = { x, y, r };
    const all_dots = existing_dots.concat(dots);
    const ok = all_dots.every(d => distance(x, y, d.x, d.y) > min_dist + r + d.r);
    if (ok) {
      dots.push(candidate);
    }
  }
  return dots;
}

function makeDots(n_blue, n_yellow, control_mode) {
  let blue_dots = generateDotPositions(n_blue, []);
  let yellow_dots = generateDotPositions(n_yellow, blue_dots);

  if (control_mode === "area_control") {
    const target_total_area = 2800;
    const blue_r = Math.sqrt(target_total_area / (Math.PI * n_blue));
    const yellow_r = Math.sqrt(target_total_area / (Math.PI * n_yellow));
    blue_dots = blue_dots.map(d => ({ ...d, r: blue_r * (0.85 + Math.random() * 0.30) }));
    yellow_dots = yellow_dots.map(d => ({ ...d, r: yellow_r * (0.85 + Math.random() * 0.30) }));
  }

  return { blue_dots, yellow_dots };
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clearCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  return ctx;
}

function drawTextCentered(ctx, text, y, font = "28px Arial") {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#222";
  ctx.fillText(text, CANVAS_W / 2, y);
}

function drawFixation(canvas) {
  const ctx = clearCanvas(canvas);
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2 - 15, CANVAS_H / 2);
  ctx.lineTo(CANVAS_W / 2 + 15, CANVAS_H / 2);
  ctx.moveTo(CANVAS_W / 2, CANVAS_H / 2 - 15);
  ctx.lineTo(CANVAS_W / 2, CANVAS_H / 2 + 15);
  ctx.stroke();
}

function drawDots(canvas, design) {
  const ctx = clearCanvas(canvas);
  const dots = makeDots(design.n_blue, design.n_yellow, design.control_mode);
  const all_dots = shuffle(
    dots.blue_dots.map(d => ({ ...d, color: "blue" })).concat(
      dots.yellow_dots.map(d => ({ ...d, color: "yellow" }))
    )
  );

  all_dots.forEach(d => {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, 2 * Math.PI);
    ctx.fillStyle = d.color === "blue" ? "#1f77b4" : "#f2c230";
    ctx.fill();
  });
}

function drawResponsePrompt(canvas) {
  const ctx = clearCanvas(canvas);
  drawTextCentered(ctx, "Which color had more dots?", 230, "30px Arial");
  drawTextCentered(ctx, "Press B for BLUE     Press Y for YELLOW", 310, "26px Arial");
}

function responseToOutcome(design, choice_index) {
  const chose_blue = Number(choice_index) === 0;
  const blue_is_correct = design.n_blue > design.n_yellow;
  return chose_blue === blue_is_correct ? 1 : 0;
}

function correctChoiceIndex(design) {
  return design.n_blue > design.n_yellow ? 0 : 1;
}

function describeDesign(design) {
  return [
    "blue dots: " + design.n_blue,
    "yellow dots: " + design.n_yellow,
    "ratio: " + design.ratio,
    "control: " + design.control_mode,
    "correct key: " + design.correct_key.toUpperCase(),
  ];
}

function withCanvasSize(trial) {
  return {
    ...trial,
    canvas_size: CANVAS_SIZE,
  };
}

const design_grid = makeDotComparisonDesigns();

const presentation = {
  getChoiceTrials(ctx) {
    const getDesign = ctx.getDesign;
    return [
      withCanvasSize(canvasFrame({ draw: drawFixation, getDesign, duration: FIXATION_MS })),
      withCanvasSize(canvasFrame({ draw: drawDots, getDesign, duration: STIM_MS })),
      withCanvasSize(canvasResponse({ draw: drawResponsePrompt, getDesign, choices: RESPONSE_KEYS }, ctx)),
    ];
  },
  describeDesign,
};

const halberdaDotComparisonTask = {
  id: "halberda_dot_comparison",
  design_grid,
  designKeys: [
    "n_blue",
    "n_yellow",
    "n_large",
    "n_small",
    "ratio",
    "ratio_value",
    "ratio_big_small",
    "more_color",
    "correct_key",
    "control_mode",
  ],
  responseSpace: { type: "binary" },
  presentation,
  choices: RESPONSE_KEYS,
  response_labels,
  responseToOutcome,
};

export default halberdaDotComparisonTask;
export {
  BASE_LARGE_COUNTS,
  CANVAS_H,
  CANVAS_SIZE,
  CANVAS_W,
  CONTROL_MODES,
  FIXATION_MS,
  RATIOS,
  RESPONSE_KEYS,
  STIM_MS,
  correctChoiceIndex,
  design_grid,
  describeDesign,
  drawDots,
  drawFixation,
  drawResponsePrompt,
  halberdaDotComparisonTask,
  makeDotComparisonDesigns,
  presentation,
  responseToOutcome,
  response_labels,
  withCanvasSize,
};
