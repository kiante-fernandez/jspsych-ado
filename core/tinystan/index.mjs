import { prepareStanJSON } from "./util.mjs";
//#region src/constants.ts
const HMC_SAMPLER_VARIABLES = [
	"lp__",
	"accept_stat__",
	"stepsize__",
	"treedepth__",
	"n_leapfrog__",
	"divergent__",
	"energy__"
];
const PATHFINDER_VARIABLES = [
	"lp_approx__",
	"lp__",
	"path__"
];
//#endregion
//#region src/model.ts
const { NULL, PTR_SIZE, defaultSamplerParams, defaultPathfinderParams } = {
	NULL: 0,
	PTR_SIZE: 4,
	defaultSamplerParams: {
		data: "",
		num_chains: 4,
		inits: "",
		seed: null,
		id: 1,
		init_radius: 2,
		num_warmup: 1e3,
		num_samples: 1e3,
		metric: 2,
		save_inv_metric: false,
		init_inv_metric: null,
		adapt: true,
		delta: .8,
		gamma: .05,
		kappa: .75,
		t0: 10,
		init_buffer: 75,
		term_buffer: 50,
		window: 25,
		save_warmup: false,
		stepsize: 1,
		stepsize_jitter: 0,
		max_depth: 10,
		refresh: 100,
		num_threads: -1
	},
	defaultPathfinderParams: {
		data: "",
		num_paths: 4,
		inits: "",
		seed: null,
		id: 1,
		init_radius: 2,
		num_draws: 1e3,
		max_history_size: 5,
		init_alpha: .001,
		tol_obj: 1e-12,
		tol_rel_obj: 1e4,
		tol_grad: 1e-8,
		tol_rel_grad: 1e7,
		tol_param: 1e-8,
		num_iterations: 1e3,
		num_elbo_draws: 25,
		num_multi_draws: 1e3,
		calculate_lp: true,
		psis_resample: true,
		refresh: 100,
		num_threads: -1
	}
};
//#endregion
//#region src/index.ts
var src_default = class StanModel {
	m;
	printErrorCallback;
	sep;
	constructor(m, pc) {
		this.m = m;
		this.printErrorCallback = pc;
		this.sep = String.fromCharCode(m._tinystan_separator_char());
	}
	/**
	* Load a StanModel from a WASM module.
	*
	* @param {Function} createModule A function that resolves to a WASM module. This is
	* much like the one Emscripten creates for you with `-sMODULARIZE`.
	* @param {PrintCallback | null} printCallback A callback that will be called
	* with any print statements from Stan. If null, this will default to `console.log`.
	* @returns {Promise<StanModel>} A promise that resolves to a `StanModel`
	*/
	static async load(createModule, printCallback = null, printErrorCallback = null) {
		printErrorCallback = printErrorCallback ?? printCallback;
		return new StanModel(await createModule({
			print: printCallback,
			printErr: printErrorCallback
		}), printErrorCallback);
	}
	encodeString(s) {
		const len = this.m.lengthBytesUTF8(s) + 1;
		const ptr = this.m._malloc(len);
		this.m.stringToUTF8(s, ptr, len);
		return ptr;
	}
	handleError(rc, err_ptr) {
		if (rc == 0) {
			this.m._free(err_ptr);
			return;
		}
		const err = this.m.getValue(err_ptr, "*");
		const err_msg_ptr = this.m._tinystan_get_error_message(err);
		const err_msg = "Exception from Stan:\n" + this.m.UTF8ToString(err_msg_ptr);
		this.m._tinystan_destroy_error(err);
		this.m._free(err_ptr);
		this.printErrorCallback?.(err_msg);
		throw new Error(err_msg);
	}
	encodeInits(inits) {
		if (Array.isArray(inits)) return this.encodeString(inits.map((i) => prepareStanJSON(i)).join(this.sep));
		else return this.encodeString(prepareStanJSON(inits));
	}
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
	withModel(data, seed, f) {
		const data_ptr = this.encodeString(prepareStanJSON(data));
		const err_ptr = this.m._malloc(PTR_SIZE);
		const model = this.m._tinystan_create_model(data_ptr, seed, NULL, err_ptr);
		this.m._free(data_ptr);
		this.handleError(model === 0, err_ptr);
		const ptrs = [];
		const deferredFree = (p) => ptrs.push(p);
		try {
			return f(model, deferredFree);
		} finally {
			ptrs.forEach((p) => this.m._free(p));
			this.m._tinystan_destroy_model(model);
		}
	}
	/**
	* Sample using NUTS-HMC.
	* @param {SamplerParams} p A (partially-specified) `SamplerParams` object.
	* If a property is not specified, the default value will be used.
	* @returns {StanDraws} A StanDraws object containing the parameter names and the draws
	*/
	sample(p) {
		const { data, num_chains, inits, seed, id, init_radius, num_warmup, num_samples, metric, save_inv_metric, adapt, delta, gamma, kappa, t0, init_buffer, term_buffer, window, save_warmup, stepsize, stepsize_jitter, max_depth, refresh, num_threads } = {
			...defaultSamplerParams,
			...p
		};
		if (num_chains < 1) throw new Error("num_chains must be at least 1");
		if (num_warmup < 0) throw new Error("num_warmup must be non-negative");
		if (num_samples < 1) throw new Error("num_samples must be at least 1");
		const seed_ = seed ?? Math.floor(Math.random() * Math.pow(2, 32));
		return this.withModel(data, seed_, (model, deferredFree) => {
			const rawParamNames = this.m.UTF8ToString(this.m._tinystan_model_param_names(model));
			const paramNames = HMC_SAMPLER_VARIABLES.concat(rawParamNames.split(","));
			const n_params = paramNames.length;
			const free_params = this.m._tinystan_model_num_free_params(model);
			const init_inv_metric_ptr = NULL;
			let inv_metric_out = NULL;
			let stepsize_out = NULL;
			if (adapt) {
				stepsize_out = this.m._malloc(num_chains * Float64Array.BYTES_PER_ELEMENT);
				if (save_inv_metric) if (metric === 1) inv_metric_out = this.m._malloc(num_chains * free_params * free_params * Float64Array.BYTES_PER_ELEMENT);
				else inv_metric_out = this.m._malloc(num_chains * free_params * Float64Array.BYTES_PER_ELEMENT);
			}
			deferredFree(stepsize_out);
			deferredFree(inv_metric_out);
			const inits_ptr = this.encodeInits(inits);
			deferredFree(inits_ptr);
			const n_draws = num_chains * (save_warmup ? num_samples + num_warmup : num_samples);
			const n_out = n_draws * n_params;
			const out_ptr = this.m._malloc(n_out * Float64Array.BYTES_PER_ELEMENT);
			deferredFree(out_ptr);
			const err_ptr = this.m._malloc(PTR_SIZE);
			const result = this.m._tinystan_sample(model, num_chains, inits_ptr, seed_, id, init_radius, num_warmup, num_samples, metric.valueOf(), init_inv_metric_ptr, adapt ? 1 : 0, delta, gamma, kappa, t0, init_buffer, term_buffer, window, save_warmup ? 1 : 0, stepsize, stepsize_jitter, max_depth, refresh, num_threads, out_ptr, n_out, stepsize_out, inv_metric_out, err_ptr);
			this.handleError(result, err_ptr);
			const out_buffer = this.m.HEAPF64.subarray(out_ptr / Float64Array.BYTES_PER_ELEMENT, out_ptr / Float64Array.BYTES_PER_ELEMENT + n_out);
			const draws = Array.from({ length: n_params }, (_, i) => Array.from({ length: n_draws }, (_, j) => out_buffer[i + n_params * j]));
			let stepsizes;
			let inv_metric_array;
			if (adapt) {
				const stepsize_buffer = this.m.HEAPF64.subarray(stepsize_out / Float64Array.BYTES_PER_ELEMENT, stepsize_out / Float64Array.BYTES_PER_ELEMENT + num_chains);
				stepsizes = Array.from({ length: num_chains }, (_, i) => stepsize_buffer[i]);
				if (save_inv_metric) if (metric === 1) {
					const inv_metric_buffer = this.m.HEAPF64.subarray(inv_metric_out / Float64Array.BYTES_PER_ELEMENT, inv_metric_out / Float64Array.BYTES_PER_ELEMENT + num_chains * free_params * free_params);
					inv_metric_array = Array.from({ length: num_chains }, (_, i) => Array.from({ length: free_params }, (_, j) => Array.from({ length: free_params }, (_, k) => inv_metric_buffer[i * free_params * free_params + j * free_params + k])));
				} else {
					const inv_metric_buffer = this.m.HEAPF64.subarray(inv_metric_out / Float64Array.BYTES_PER_ELEMENT, inv_metric_out / Float64Array.BYTES_PER_ELEMENT + num_chains * free_params);
					inv_metric_array = Array.from({ length: num_chains }, (_, i) => Array.from({ length: free_params }, (_, j) => inv_metric_buffer[i * free_params + j]));
				}
			}
			return {
				paramNames,
				draws,
				inv_metric: inv_metric_array,
				stepsize: stepsizes
			};
		});
	}
	/**
	* Approximate the posterior using Pathfinder.
	* @param {PathfinderParams} p A (partially-specified) `PathfinderParams` object.
	* If a property is not specified, the default value will be used.
	* @returns {StanDraws} A StanDraws object containing the parameter names and the
	* approximate draws
	*/
	pathfinder(p) {
		const { data, num_paths, inits, seed, id, init_radius, num_draws, max_history_size, init_alpha, tol_obj, tol_rel_obj, tol_grad, tol_rel_grad, tol_param, num_iterations, num_elbo_draws, num_multi_draws, calculate_lp, psis_resample, refresh, num_threads } = {
			...defaultPathfinderParams,
			...p
		};
		if (num_paths < 1) throw new Error("num_paths must be at least 1");
		if (num_draws < 1) throw new Error("num_draws must be at least 1");
		if (num_multi_draws < 1) throw new Error("num_multi_draws must be at least 1");
		const output_rows = calculate_lp && psis_resample ? num_multi_draws : num_draws * num_paths;
		const seed_ = seed !== null ? seed : Math.floor(Math.random() * Math.pow(2, 32));
		return this.withModel(data, seed_, (model, deferredFree) => {
			const rawParamNames = this.m.UTF8ToString(this.m._tinystan_model_param_names(model));
			const paramNames = PATHFINDER_VARIABLES.concat(rawParamNames.split(","));
			const n_params = paramNames.length;
			if (this.m._tinystan_model_num_free_params(model) === 0) throw new Error("Model has no parameters.");
			const inits_ptr = this.encodeInits(inits);
			deferredFree(inits_ptr);
			const n_out = output_rows * n_params;
			const out = this.m._malloc(n_out * Float64Array.BYTES_PER_ELEMENT);
			deferredFree(out);
			const err_ptr = this.m._malloc(PTR_SIZE);
			const result = this.m._tinystan_pathfinder(model, num_paths, inits_ptr, seed_, id, init_radius, num_draws, max_history_size, init_alpha, tol_obj, tol_rel_obj, tol_grad, tol_rel_grad, tol_param, num_iterations, num_elbo_draws, num_multi_draws, calculate_lp ? 1 : 0, psis_resample ? 1 : 0, refresh, num_threads, out, n_out, err_ptr);
			this.handleError(result, err_ptr);
			const out_buffer = this.m.HEAPF64.subarray(out / Float64Array.BYTES_PER_ELEMENT, out / Float64Array.BYTES_PER_ELEMENT + n_out);
			return {
				paramNames,
				draws: Array.from({ length: n_params }, (_, i) => Array.from({ length: output_rows }, (_, j) => out_buffer[i + n_params * j]))
			};
		});
	}
	/**
	* Get the version of the Stan library being used.
	* @returns {string} The version of the Stan library being used,
	* in the form "major.minor.patch"
	*/
	stanVersion() {
		const major = this.m._malloc(4);
		const minor = this.m._malloc(4);
		const patch = this.m._malloc(4);
		this.m._tinystan_stan_version(major, minor, patch);
		const version = this.m.getValue(major, "i32") + "." + this.m.getValue(minor, "i32") + "." + this.m.getValue(patch, "i32");
		this.m._free(major);
		this.m._free(minor);
		this.m._free(patch);
		return version;
	}
};
//#endregion
export { src_default as default };