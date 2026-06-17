# Testing

The suite has two independent entry points: Python tests (the ADO engine and
FastAPI service) and JavaScript tests (the jsPsych timeline, controllers, and
utilities).

## Python (pytest)

```bash
uv run pytest                  # everything except slow recovery tests is fast
uv run pytest -m "not slow"    # skip the simulated-recovery loop
uv run pytest -m slow          # run only the recovery tests
```

| File | What it covers |
|------|----------------|
| `tests/test_dd_engine.py` | Behavioral checks on `DelayDiscountingSession`: the posterior actually moves after a response, uncertainty narrows over consistent trials, impatient responding pushes the `k` estimate up, designs vary and stay inside the grid. |
| `tests/test_api.py` | Full API contract: valid initial state, both choice values, multi-trial sessions, 404 on unknown session, 400 on missing fields, and that two sessions keep independent state. |
| `tests/test_parity.py` | Replays a fixed response sequence through the wrapper and asserts the selected designs and posteriors match a committed ADOpy reference within `1e-6`. Skips if the fixture has not been generated. |
| `tests/test_recovery.py` | Slow. Simulates participants with known `k`; asserts the posterior recovers the correct region (directional). |

### Testing the ADOpy wrapper against ADOpy

`tests/test_parity.py` compares the wrapper against a committed ground-truth
file produced from raw ADOpy. Generate (or regenerate) it whenever ADOpy or the
default grids change:

```bash
python tests/generate_fixtures.py
```

This writes `tests/fixtures/adopy_reference_sequence.json`, which records the
ADOpy version and grid configuration in its header. Commit the regenerated file.
Until it exists, the parity tests skip with an explanatory message rather than
fail.

## JavaScript (vitest + jsdom)

```bash
npm install        # first time only
npm test           # run once
npm run test:watch # watch mode
```

| File | What it covers |
|------|----------------|
| `tests/js/utils.test.js` | Grid helpers (`linspace`, `logspace`, `range`) and the participant-facing stimulus HTML rendered by `makeChoiceStimulus`. |
| `tests/js/controllers.test.js` | The mock and fixture controllers in isolation: lifecycle, trial-index advancement, design variation, grid membership, ordered fixture replay. |
| `tests/js/timeline.test.js` | The timeline end to end: correct trial structure, and — via jsPsych's data-only simulation — that design fields, session id, trial index, choice/label, posterior fields, and `ado_design` are written into the data exactly as a real run would. |

The timeline references `jsPsychHtmlButtonResponse` and `jsPsychCallFunction` as
globals (the browser loads them via `<script>` tags). `timeline.test.js`
registers the real npm plugin classes on `globalThis` before building the
timeline, then drives it with `jsPsych.simulate(timeline, "data-only")`.
