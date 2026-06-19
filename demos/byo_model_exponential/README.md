# Bring your own model — exponential discounting

**Pattern 3** (see [`../README.md`](../README.md)): reuse a **packaged task**, supply
your **own model**. Unlike the other demos, the model here is **authored in this
folder** — the Stan source, the adapter, and the compiled artifacts all live next to
the page:

```
demos/byo_model_exponential/
  exponential.stan   ← the model you wrote (V = R·e^(−k·t))
  model.js           ← the adapter: prior + responseProb + stanData
  main.js, main.wasm ← exponential.stan compiled to WASM (committed)
  index.html         ← the demo, importing ./model.js
```

It pairs with the **packaged** delay-discounting task unchanged — a task and a model
are independent, so the only thing that differs from the
[delay-discounting demo](../delay_discounting/) is the model.

Run it (serve the repo statically):

```text
demos/byo_model_exponential/index.html?controller=stan&strategy=ado&debug=1
```

## How the model was authored

1. **Write the Stan model** — [`exponential.stan`](exponential.stan). It mirrors the
   packaged `hyperbolic.stan` except the value function:

   ```stan
   v_ss = r_ss .* exp(-k * t_ss);   // exponential:  V = R * exp(-k*t)
   v_ll = r_ll .* exp(-k * t_ll);   // (hyperbolic was r ./ (1 + k*t))
   y ~ bernoulli_logit(tau * (v_ll - v_ss));
   ```

2. **Compile it to WASM, once, offline.** The exact commands are in
   [`PROVENANCE.md`](PROVENANCE.md), then `npm run patch:wasm`, then commit
   `main.js` + `main.wasm`. Compiling happens offline (curl / Node / CI) rather than
   in the browser because the public compile server only accepts browser requests
   from its own origin (CORS); committing the wasm also means the live page is pure
   static assets with no runtime dependency on a compile server.

3. **Write the adapter** — [`model.js`](model.js): `params`, a `prior` matching the
   `.stan` priors, a `responseProb` matching the `.stan` likelihood (this one JS
   function is what the MI engine and the simulator use), and a `stanData` map
   mirroring the `.stan` data block.

4. **Sanity-check it** — a real-WASM recovery smoke
   ([`../../tests/js/exponential_recovery.smoke.mjs`](../../tests/js/exponential_recovery.smoke.mjs))
   confirms the compiled model recovers known parameters, and the likelihood-parity
   smoke confirms the JS `responseProb` matches the compiled Stan likelihood
   draw-for-draw. Both run in CI.

## How it's used here

```js
import delayDiscountingTask from ".../tasks/delay_discounting/task.js"; // packaged task
import exponentialModel from "./model.js";                              // your model, in this folder

jsPsychADO.registerTask(delayDiscountingTask.id, delayDiscountingTask);
jsPsychADO.registerModelPackage(exponentialModel, { stan, n_trials: 42 });
const ado = jsPsychADO.createTimeline(jsPsych, { task: delayDiscountingTask.id, model: exponentialModel.id });
```

(For runnability this page goes through the shared demo "experiment shell" — URL
switches + simulation — like the other demos. The interface itself is the calls above.)
