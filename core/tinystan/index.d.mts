import { a as StanVariableInputs, i as StanDraws, n as PrintCallback, r as SamplerParams, t as PathfinderParams } from "./types-BxjbB-KD.mjs";

//#region src/model.d.ts
/**
 * StanModel is a class that wraps the WASM module and provides a
 * higher-level interface to the Stan library, abstracting away things
 * like memory management and error handling.
 */
declare class StanModel {
  private m;
  private printErrorCallback;
  private sep;
  private constructor();
  /**
   * Load a StanModel from a WASM module.
   *
   * @param {Function} createModule A function that resolves to a WASM module. This is
   * much like the one Emscripten creates for you with `-sMODULARIZE`.
   * @param {PrintCallback | null} printCallback A callback that will be called
   * with any print statements from Stan. If null, this will default to `console.log`.
   * @returns {Promise<StanModel>} A promise that resolves to a `StanModel`
   */
  static load(createModule: (moduleArg?: object) => Promise<object>, printCallback?: PrintCallback | null, printErrorCallback?: PrintCallback | null): Promise<StanModel>;
  private encodeString;
  private handleError;
  private encodeInits;
  /** @ignore
   * withModel serves as something akin to a context manager in
   * Python. It accepts the arguments needed to construct a model
   * (data and seed) and a callback.
   *
   * The callback takes in the model and a deferredFree function.
   * The memory for the allocated model and any pointers which are "registered"
   * by calling deferredFree will be cleaned up when the callback completes,
   * regardless of if this is a normal return or an exception.
   *
   * The result of the callback is then returned or re-thrown.
   */
  private withModel;
  /**
   * Sample using NUTS-HMC.
   * @param {SamplerParams} p A (partially-specified) `SamplerParams` object.
   * If a property is not specified, the default value will be used.
   * @returns {StanDraws} A StanDraws object containing the parameter names and the draws
   */
  sample(p: Partial<SamplerParams>): StanDraws;
  /**
   * Approximate the posterior using Pathfinder.
   * @param {PathfinderParams} p A (partially-specified) `PathfinderParams` object.
   * If a property is not specified, the default value will be used.
   * @returns {StanDraws} A StanDraws object containing the parameter names and the
   * approximate draws
   */
  pathfinder(p: Partial<PathfinderParams>): StanDraws;
  /**
   * Get the version of the Stan library being used.
   * @returns {string} The version of the Stan library being used,
   * in the form "major.minor.patch"
   */
  stanVersion(): string;
}
//#endregion
export { type PathfinderParams, type PrintCallback, type SamplerParams, type StanDraws, type StanVariableInputs, StanModel as default };