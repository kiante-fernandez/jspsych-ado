// Type declarations for jspsych-ado.
//
// Hand-written because the library is plain ESM JavaScript (no TypeScript build — see the
// "Working with Stan and WASM" carve-outs in CONTRIBUTING.md). This file describes the
// public `jsPsychADO` façade exported from the package entry; it is type-checked in CI
// (`npm run typecheck`) so it cannot silently drift from src/index.js. Deep imports
// (`jspsych-ado/models/*`) are untyped today — annotate their default exports with the
// exported `ModelPackage` type if you need them.

/** A prior over one model parameter — the families the first-design sampler can draw. */
export type Prior =
  | { dist: "normal"; mean: number; sd: number }
  | { dist: "lognormal"; meanlog: number; sdlog: number }
  | { dist: "halfnormal"; sd: number };

/** The response space a model operates over. */
export type ResponseSpace =
  | { type: "binary" }
  | { type: "categorical"; n_categories: number }
  | { type: "continuous"; intervals?: number };

/** One candidate design: a record of design-key → value. */
export type Design = Record<string, unknown>;

/** One posterior (or prior) draw: parameter name → value. */
export type Draw = Record<string, number>;

/** Sampler settings forwarded to Stan. */
export interface StanConfig {
  num_chains?: number;
  num_warmup?: number;
  num_samples?: number;
  seed?: number;
}

/** Adaptive early-stopping config (#21). Omit (or omit `eig_fraction`) for a fixed-length run. */
export interface StoppingConfig {
  /** Stop when the best next design's EIG falls below `eig_fraction * ln(K)` nats. */
  eig_fraction?: number;
  /** Never stop before this many trials. */
  min_trials?: number;
  /** Hard trial cap (defaults to `n_trials`). */
  max_trials?: number;
  /** Require this many consecutive sub-threshold refits before stopping (de-bounce). */
  consecutive?: number;
}

/** Per-parameter debug-chart display hints. */
export interface PosteriorDisplay {
  [param: string]: {
    label?: string;
    y_min?: number;
    y_max?: number;
    lower_bound?: number;
    upper_bound?: number;
    min_y_span?: number;
  };
}

/** A model package: parameters, prior, likelihood, Stan data boundary, and compiled artifacts. */
export interface ModelPackage {
  id: string;
  params: string[];
  designKeys: string[];
  responseSpace: ResponseSpace;
  prior?: Record<string, Prior>;
  /** Compiled module URL, e.g. `new URL("./main.js", import.meta.url).href`. */
  moduleUrl: string;
  /** Compiled wasm URL (so bundlers emit/hash it); `new URL("./main.wasm", import.meta.url).href`. */
  wasmUrl?: string;
  /** Declarative Stan `data` map (preferred over a hand-written builder). */
  stanData?: Record<string, unknown>;
  buildData?: (trials: Array<Design & { choice: number }>) => Record<string, unknown>;
  toStanData?: (rows: Array<{ design: Design; response: unknown }>) => Record<string, unknown>;
  /** Binary likelihood: P(outcome = 1). */
  responseProb?: (design: Design, draw: Draw) => number;
  /** Categorical likelihood: [p0, p1, …] summing to 1. */
  responseProbs?: (design: Design, draw: Draw) => number[];
  /** Continuous likelihood: p(y | θ, design) ≥ 0. */
  responseDensity?: (design: Design, draw: Draw, y: number) => number;
  /** Continuous: {mean, sd} used to auto-derive the integration support. */
  responseMoments?: (design: Design, draw: Draw) => { mean: number; sd: number };
  /** Continuous: explicit integration support, an alternative to responseMoments. */
  responseSupport?: [number, number] | ((design: Design, draws: Draw[]) => [number, number]);
  /** Continuous: closed-form H(y | θ, design). */
  conditionalEntropy?: (design: Design, draw: Draw) => number;
  /** Continuous: hot-loop fast path; must equal responseDensity. */
  responseDensityFactory?: (design: Design, draw: Draw) => (y: number) => number;
  /** Continuous: data-generating sampler used by the simulated participant. */
  responseSampler?: (design: Design, params: Draw, rng: () => number) => number;
  posterior_display?: PosteriorDisplay;
  stan?: StanConfig;
  n_trials?: number;
  testlet_size?: number;
  stopping?: StoppingConfig | null;
}

/** Synthetic-participant config for jsPsych.simulate() runs. */
export interface SimulateConfig {
  /** True parameter values the synthetic participant responds with. */
  participant: Record<string, number>;
  /** Simulated response time in ms (default 500). */
  rt_ms?: number;
  /** RNG seed for reproducible simulated runs. */
  seed?: number;
  /** jsPsych simulation mode recorded in the run context (default "data-only"). */
  mode?: "data-only" | "visual";
  /** Map the drawn model outcome to plugin data (e.g. outcome index → key string). */
  respond?: (design: Design, sim: Record<string, unknown>) => Record<string, unknown>;
}

/** Options shared by createController config and per-timeline overrides. */
export interface AdoRunOptions {
  stan?: StanConfig;
  n_trials?: number;
  testlet_size?: number;
  stopping?: StoppingConfig | null;
  /** "stan" (live in-browser inference, default) or "mock" (deterministic, no WASM). */
  controller?: "stan" | "mock";
  /** "ado" for MI-optimal designs (default), "random" for the recovery baseline. */
  design_strategy?: "ado" | "random";
  design_seed?: number | null;
  session_id?: string;
  /** true/false, or "url" (default) to honor `?debug=1` on the page URL. */
  debug?: boolean | "url";
  /** Outcome labels; inferred from the response trial's static `choices` when omitted. */
  response_labels?: string[] | Record<number, string>;
  /** Human-readable design lines for the debug log. */
  describeDesign?: (design: Design) => string[];
  /** Synthetic participant for jsPsych.simulate(). */
  simulate?: SimulateConfig | null;
}

/** Config for {@link createController}. */
export interface CreateControllerConfig extends AdoRunOptions {
  /** A model package (committed under `jspsych-ado/models/*` or authored locally). */
  model: ModelPackage;
  /** Candidate designs: an object of value arrays (cartesian product) or an array of designs. */
  design_grid: Record<string, unknown[]> | Design[];
}

/** Per-timeline overrides for {@link AdoController.createTimeline}. */
export interface CreateTimelineOptions extends AdoRunOptions {
  /** Which trial of a multi-trial step collects the response (default: the last). */
  response_trial_index?: number;
}

/** A jsPsych trial description (plugin `type` plus parameters). */
export type JsPsychTrial = Record<string, unknown>;

/** Context passed to a trial factory: live design/state accessors plus the handle. */
export interface AdoTrialContext {
  getDesign: () => Design | null;
  getState: () => Record<string, unknown> | null;
  choices?: unknown;
  response_labels?: Record<number, string> | null;
  trial_number: number;
  ado: AdoController;
}

/**
 * The controller handle returned by {@link createController}: design accessors for
 * ordinary jsPsych trials, the response boundary, and the timeline builder.
 */
export interface AdoController {
  /** A copy of the current design object. */
  getDesign(): Design;
  /** The current value of one design variable (use inside dynamic trial parameters). */
  evaluateDesignVariable(key: string): unknown;
  /** A function-valued trial parameter that resolves the design variable at run time. */
  designVariable(key: string): () => unknown;
  /** The latest controller state (posterior summaries, next-design diagnostics). */
  getState(): Record<string, unknown> | null;
  /**
   * Record the model outcome for the current adaptive trial. Call exactly once from
   * the adaptive trial's on_finish (binary: 0/1; categorical: 0..K-1; continuous: a
   * finite number) after mapping the plugin's raw response.
   */
  recordResponse(response: number): void;
  /**
   * Wrap user-authored jsPsych trials into the adaptive ADO loop. Accepts one trial,
   * an array of trials per adaptive step, or a factory `(ctx) => trial(s)`.
   * Returns a jsPsych timeline fragment to spread into `jsPsych.run([...])`.
   */
  createTimeline(
    trialOrTrials:
      JsPsychTrial | JsPsychTrial[] | ((ctx: AdoTrialContext) => JsPsychTrial | JsPsychTrial[]),
    options?: CreateTimelineOptions,
  ): any[];
}

/**
 * Create an ADO controller handle for one model + design grid (#135).
 *
 * @param jsPsych - The `initJsPsych()` instance.
 */
export function createController(jsPsych: unknown, config: CreateControllerConfig): AdoController;

/**
 * A model authored from Stan source. Provide exactly one of `stanCode`, `stanUrl`, or
 * `moduleUrl`; the prior is parsed from the Stan source unless given explicitly.
 */
export interface ModelSpec extends Partial<Omit<ModelPackage, "moduleUrl">> {
  stanCode?: string;
  stanUrl?: string;
  moduleUrl?: string;
}

/**
 * Compile a source model spec into a model package usable with createController
 * (prototyping path; production models commit precompiled main.js/main.wasm).
 */
export function prepareModel(
  spec: ModelSpec,
  opts: { compileServer: string; authToken?: string },
): Promise<ModelPackage>;

export interface ValidationProblem {
  level: "error" | "warn";
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  problems: ValidationProblem[];
}

/** Validate a model package's shape (optionally probing the likelihood at a sample design/draw). */
export function validateModel(
  model: unknown,
  opts?: { sampleDesign?: Design; sampleDraw?: Draw },
): ValidationResult;

/** Half-open design-grid axis [start, stop) with the given step. */
export function arange(start: number, stop: number, step?: number): number[];

/** Inclusive design-grid axis [start, stop] with `num` points. */
export function linspace(start: number, stop: number, num: number): number[];

/** Build a Stan data-block builder from a declarative `stanData` map. */
export function makeStanDataBuilder(spec: {
  stanData?: Record<string, unknown>;
  responseSpace: ResponseSpace;
}): (trials: Array<Design & { choice: number }>) => Record<string, unknown>;

/**
 * The `jsPsychADO` façade — the documented public API (also the default export).
 */
export interface JsPsychADO {
  createController: typeof createController;
  prepareModel: typeof prepareModel;
  validateModel: typeof validateModel;
  arange: typeof arange;
  linspace: typeof linspace;
  makeStanDataBuilder: typeof makeStanDataBuilder;
}

export const jsPsychADO: JsPsychADO;
export default jsPsychADO;

// --- Advanced / internal (exported for power users + the test suite; NOT part of the
// stable façade and may change without a major bump while pre-1.0). ---

/** Derive the JS prior `{ param: { dist, … } }` from a `.stan` source. */
export function parseStanPriors(
  stanCode: string,
  paramSpecs: Array<string | { name: string; lower?: number }>,
): Record<string, Prior>;

/** Convert ["SS","LL"] → {0:"SS",1:"LL"}; pass an object through unchanged. */
export function labelsToConfig(labels: string[] | Record<number, string>): Record<number, string>;

/** Validate a model package and adapt it to the engine's controller shape. */
export function buildModelAdapter(model: ModelPackage, context?: string): ModelPackage;
