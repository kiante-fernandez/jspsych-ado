// A real bundler consumer using the PUBLIC API (registerModelPackage -> createTimeline)
// with plugin injection and NO globalThis assignment. The runner builds this with
// Vite (production) and headlessly confirms the hashed WASM loads and a posterior is
// produced — the exact path #57 repairs.
import { initJsPsych } from "jspsych";
import htmlButtonResponse from "@jspsych/plugin-html-button-response";
import callFunction from "@jspsych/plugin-call-function";
import { jsPsychADO } from "jspsych-ado";
import hyperbolic from "jspsych-ado/models/hyperbolic/model.js";
import ddTask from "jspsych-ado/tasks/delay_discounting/task.js";
import "jspsych-ado/tasks/delay_discounting/task.css";

window.__spike = { done: false, error: null };
// Expose the bundler-rewritten URLs so the runner can confirm hashing happened.
window.__urls = { moduleUrl: hyperbolic.moduleUrl, wasmUrl: hyperbolic.wasmUrl };

(async () => {
  try {
    jsPsychADO.registerTask(ddTask.id, ddTask);
    jsPsychADO.registerModelPackage(hyperbolic, {
      n_trials: 3,
      stan: { num_chains: 1, num_warmup: 100, num_samples: 200, seed: 1 },
    });

    const jsPsych = initJsPsych({
      on_finish: () => {
        const rows = jsPsych.data.get().values();
        const post = rows.map((r) => r.post_mean_k).filter((v) => typeof v === "number" && isFinite(v));
        window.__spike = { done: true, error: null, post_mean_k: post };
      },
    });

    const run_context = {
      ado_mode: "stan",
      controller_mode: "stan",
      design_strategy: "ado",
      model_id: hyperbolic.id,
      debug: false,
      param_history: {},
      posterior_display: hyperbolic.posterior_display,
      simulation_mode: "data-only",
      session_id: "fixture",
    };

    const timeline = jsPsychADO.createTimeline(
      jsPsych,
      {
        model: hyperbolic.id,
        task: ddTask.id,
        session_id: "fixture",
        n_trials: 3,
        design_strategy: "ado",
        plugins: { htmlButtonResponse, callFunction },
      },
      run_context
    );

    await jsPsych.simulate(timeline, "data-only");
  } catch (e) {
    window.__spike = { done: false, error: String((e && e.stack) || e) };
  }
})();
