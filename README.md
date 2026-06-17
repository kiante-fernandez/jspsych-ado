# jspsych-ado

Scaffold for a jsPsych/JATOS delay discounting experiment that gets adaptive designs from ADOpy through a small Python API.

The browser experiment lives in `experiments/delay_discounting/`. The Python service lives in `ado_service/`.

## Run the mock experiment

Open this file with Live Server:

```text
experiments/delay_discounting/index.html?ado=mock
```

The mock controller does not need Python. It returns deterministic designs so the timeline and data fields can be reviewed immediately.

## Run the Python ADO service

```bash
uv run uvicorn ado_service.app:app --reload --port 8000
```

Then open:

```text
experiments/delay_discounting/index.html?ado=api&api=http://127.0.0.1:8000
```

## Debug trace logs

Add `debug=1` to print a readable console summary after each adaptive update:

```text
experiments/delay_discounting/index.html?ado=mock&debug=1
experiments/delay_discounting/index.html?ado=api&api=http://127.0.0.1:8000&debug=1
```

The trace shows the design just presented, the response, posterior mean/sd,
the next selected design, mode, and API latency when using the Python service.
In DevTools, each summary also has a collapsed details group with tables.

## Run simulated participants

Add `simulate=data-only` to generate jsPsych data without clicks:

```text
experiments/delay_discounting/index.html?ado=mock&simulate=data-only
experiments/delay_discounting/index.html?ado=api&api=http://127.0.0.1:8000&simulate=data-only
```

Add `simulate=visual` to watch jsPsych click through the same simulated run:

```text
experiments/delay_discounting/index.html?ado=mock&simulate=visual
```

The simulated participant parameters live in
`experiments/delay_discounting/dd_config.js` as `default_dd_simulation_config`.
The browser uses jsPsych's standard simulation API, so the generated data still
comes from the experiment timeline rather than a separate data generator.

## Run tests

```bash
uv run pytest
```

## JATOS

Create a JATOS component pointing to:

```text
experiments/delay_discounting/index.html
```

The experiment uses the same local/JATOS base-path pattern as the existing `online_experiments` project.
