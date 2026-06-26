import { canvasSliderChoice } from "../../ado/response_trials.js";

// Magnitude-estimation task: show a filled disk of a given AREA and ask the
// participant to estimate its perceived size on a continuous slider. Paired with the
// magnitude_estimation model (Stevens' power law) it recovers the perceptual exponent.
//
// The design carries the physical area s; the slider records a raw estimate, and
// responseToOutcome logs it into the modeled response y = log(estimate) (the model
// works in log-log space). The whole task is presentation + response coding; the
// statistics live entirely in the model.

const CANVAS = 420; // square canvas (height === width avoids axis ambiguity)
const CANVAS_SIZE = [CANVAS, CANVAS];
const MAX_AREA = 1000; // largest area in the design grid
const MAX_RADIUS_PX = 175; // largest on-screen radius (fits the canvas with margin)
// Pixels per sqrt(area-unit), so area s maps to radius sqrt(s/pi) scaled to fit.
const PIXELS_PER_UNIT = MAX_RADIUS_PX / Math.sqrt(MAX_AREA / Math.PI);

const SLIDER_MIN = 1;
const SLIDER_MAX = 200;

// Physical magnitudes (areas), spanning ~2 log-decades so the log-log slope (the
// Stevens exponent) is identifiable; ADO favors the ends of this range.
const design_grid = { s: [10, 25, 50, 100, 250, 500, 1000] };

/** On-screen radius (px) for a disk of physical area `area`: sqrt(area/pi) scaled to fit. */
function radiusPx(area) {
  return Math.sqrt(area / Math.PI) * PIXELS_PER_UNIT;
}

function drawDisk(canvas, design) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, CANVAS, CANVAS);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS, CANVAS);
  ctx.beginPath();
  ctx.arc(CANVAS / 2, CANVAS / 2, radiusPx(design.s), 0, 2 * Math.PI);
  ctx.fillStyle = "#3b6ea5";
  ctx.fill();
}

/**
 * Map the raw slider estimate to the modeled response y = log(estimate). The model works
 * in log-log space (Stevens' power law), so the raw slider value is logged here — the
 * task→model boundary. (The smoke/simulator feed the modeled log-response directly.)
 * Guards against a non-positive estimate.
 *
 * @param {Object} design - Current design (the area `s`; unused — the response is the estimate).
 * @param {number} estimate - Raw slider value.
 * @returns {number} log(estimate).
 */
function responseToOutcome(design, estimate) {
  return Math.log(Math.max(Number(estimate), 1e-9));
}

function describeDesign(design) {
  return ["area: " + design.s];
}

const presentation = {
  getChoiceTrials(ctx) {
    return [
      canvasSliderChoice(
        {
          draw: drawDisk,
          getDesign: ctx.getDesign,
          min: SLIDER_MIN,
          max: SLIDER_MAX,
          step: 1,
          slider_start: Math.round((SLIDER_MIN + SLIDER_MAX) / 2),
          labels: ["smallest", "largest"],
          prompt: "<p>How large is this shape? Set the slider to your estimate of its size.</p>",
          require_movement: true,
          canvas_size: CANVAS_SIZE,
        },
        ctx,
      ),
    ];
  },
  describeDesign,
};

const magnitudeEstimationTask = {
  id: "magnitude_estimation",
  design_grid,
  designKeys: ["s"],
  responseSpace: { type: "continuous" },
  presentation,
  responseToOutcome,
};

export default magnitudeEstimationTask;
export {
  CANVAS,
  CANVAS_SIZE,
  SLIDER_MIN,
  SLIDER_MAX,
  design_grid,
  drawDisk,
  radiusPx,
  describeDesign,
  presentation,
  responseToOutcome,
  magnitudeEstimationTask,
};
