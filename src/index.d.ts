// Type declarations for jspsych-ado.
//
// Hand-written because the library is plain ESM JavaScript (no TypeScript build — see the
// "Working with Stan and WASM" carve-outs in CONTRIBUTING.md). This file describes the
// public `jsPsychADO` façade exported from the package entry; it is type-checked in CI
// (`npm run typecheck`) so it cannot silently drift from src/index.js. Deep imports
// (`jspsych-ado/models/*`, `jspsych-ado/tasks/*`) are untyped today — annotate their
// default exports with the exported `ModelPackage` / `TaskPackage` types if you need them.

/** A prior over one model parameter — the families the first-design sampler can draw. */
export type Prior =
  | { dist: "normal"; mean: number; sd: number }
  | { dist: "lognormal"; meanlog: number; sdlog: number }
  | { dist: "halfnormal"; sd: number };

/** The response space a task and model operate over. */
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

/** A task package: presentation, design grid, and response coding. */
export interface TaskPackage {
  id: string;
  design_grid: Record<string, unknown[]> | Design[];
  designKeys: string[];
  responseSpace: ResponseSpace;
  /** `getChoiceTrials(ctx)` (multi-frame) or `makeStimulus(design)` (single-button). */
  presentation: unknown;
  choices?: string[];
  response_labels?: Record<number, string> | string[];
  /** Map a raw response to the model outcome (default identity). */
  responseToOutcome?: (design: Design, rawResponse: unknown) => number;
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

/** Overrides accepted by {@link registerModelPackage}. */
export interface ModelPackageOverrides {
  name?: string;
  stan?: StanConfig;
  n_trials?: number;
  testlet_size?: number;
  stopping?: StoppingConfig | null;
}

/**
 * A model registered from source. Provide exactly one of `stanCode`, `stanUrl`, or
 * `moduleUrl`; the prior is parsed from the Stan source unless given explicitly.
 */
export interface ModelSpec extends Partial<
  Omit<ModelPackage, "params" | "designKeys" | "responseSpace">
> {
  stanCode?: string;
  stanUrl?: string;
  moduleUrl?: string;
  params: Array<string | { name: string; lower?: number }>;
  designKeys: string[];
  responseSpace: ResponseSpace;
}

export interface ValidationProblem {
  level: "error" | "warn";
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  problems: ValidationProblem[];
}

/** Config for {@link createTimeline}. */
export interface CreateTimelineConfig {
  /** A registered task name. */
  task: string;
  /** A registered model name. */
  model: string;
  stan?: StanConfig;
  n_trials?: number;
  testlet_size?: number;
  session_id?: string;
  /** "ado" for MI-optimal designs, "random" for the recovery baseline. */
  design_strategy?: "ado" | "random";
  design_seed?: number | null;
  stopping?: StoppingConfig | null;
  /** Injected jsPsych plugin classes for bundler consumers (falls back to UMD globals). */
  plugins?: Record<string, unknown>;
}

/** Register a task package (presentation + response coding). */
export function registerTask(name: string, spec: TaskPackage): void;

/** Register a model from a Stan source string, a `.stan` URL, or a precompiled module URL. */
export function registerModel(name: string, spec: ModelSpec): void;

/** Register a committed model package in one call. Returns the registered model name. */
export function registerModelPackage(
  model: ModelPackage,
  overrides?: ModelPackageOverrides,
): string;

/** Validate a task package's shape. */
export function validateTask(task: unknown): ValidationResult;

/** Validate a model package's shape (optionally probing the likelihood at a sample design/draw). */
export function validateModel(
  model: unknown,
  opts?: { sampleDesign?: Design; sampleDraw?: Draw },
): ValidationResult;

/** Compile any models registered from Stan source. Run once at study setup. */
export function prepareModels(opts: { compileServer: string; authToken?: string }): Promise<void>;

/**
 * Build the adaptive jsPsych timeline fragment for a registered task/model pair.
 *
 * @param jsPsych - The `initJsPsych()` instance.
 * @returns A jsPsych timeline fragment to spread into `jsPsych.run([...])`.
 */
export function createTimeline(
  jsPsych: unknown,
  config: CreateTimelineConfig,
  run_context?: Record<string, unknown>,
): any[];

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
  registerTask: typeof registerTask;
  registerModel: typeof registerModel;
  registerModelPackage: typeof registerModelPackage;
  validateTask: typeof validateTask;
  validateModel: typeof validateModel;
  prepareModels: typeof prepareModels;
  createTimeline: typeof createTimeline;
  arange: typeof arange;
  linspace: typeof linspace;
  makeStanDataBuilder: typeof makeStanDataBuilder;
}

export const jsPsychADO: JsPsychADO;
export default jsPsychADO;

// --- Advanced / internal (exported for power users + the test suite; NOT part of the
// stable façade and may change without a major bump while pre-1.0). ---

/** Throws if a registered task/model pair is incompatible (the createTimeline gate). */
export function validateTaskModelPair(
  task: TaskPackage,
  model: ModelPackage,
  taskName: string,
  modelName: string,
): void;

/** Derive the JS prior `{ param: { dist, … } }` from a `.stan` source. */
export function parseStanPriors(
  stanCode: string,
  paramSpecs: Array<string | { name: string; lower?: number }>,
): Record<string, Prior>;

/** Turn a registry entry into the engine's model adapter shape. */
export function buildAdapter(entry: unknown): ModelPackage;

/** Convert ["SS","LL"] → {0:"SS",1:"LL"}; pass an object through unchanged. */
export function labelsToConfig(labels: string[] | Record<number, string>): Record<number, string>;
