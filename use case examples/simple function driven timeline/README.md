# Simple function-driven timeline

This example shows the smallest version of the dynamic-stimulus idea.

It does not use ADOpy. It does not use Python. The next trial is chosen by a normal JavaScript function.

## What this demonstrates

The example uses:

```js
createFunctionDrivenTimeline(...)
```

from:

```text
core/dynamic_timeline.js
```

The user provides two functions:

```js
make_trial(...)
choose_next_design(...)
```

`make_trial(...)` creates the jsPsych trial.

`choose_next_design(...)` looks at the previous trial data and returns the design for the next trial.

## Core idea

```js
function chooseNextDesign({ last_trial_data, history }) {
  if (last_trial_data.response === 0) {
    return { difficulty: last_trial_data.difficulty + 1 };
  }

  return { difficulty: Math.max(1, last_trial_data.difficulty - 1) };
}
```

This means:

```text
If the participant says the trial was too easy, make the next one harder.
If the participant says the trial was too hard, make the next one easier.
```

## What variables can my function use?

`choose_next_design(...)` receives:

```js
{
  trial_number,
  next_trial_number,
  current_design,
  last_trial_data,
  history,
  state,
  config,
  jsPsych,
}
```

The most useful ones are:

- `last_trial_data`: the data saved from the previous jsPsych trial.
- `history`: all previous dynamic trials, including their designs and saved data.
- `current_design`: the design that was just shown.
- `next_trial_number`: the upcoming trial number.
- `config`: any task settings you passed in.

So a user-defined function can do simple things like:

```js
function chooseNextDesign({ last_trial_data, next_trial_number }) {
  return {
    trial_label: next_trial_number,
    difficulty: last_trial_data.response === 0
      ? last_trial_data.difficulty + 1
      : last_trial_data.difficulty - 1,
  };
}
```

## Run locally

From the project root:

```powershell
cd C:\Users\xiaohonc\Downloads\jspsych-ado-main\jspsych-ado-main
python -m http.server 5500
```

Then open:

```text
http://127.0.0.1:5500/examples/simple_function_driven_timeline/index.html
```

## Why this exists

The ADOpy delay discounting example is useful for real adaptive inference, but sometimes users only need a simple rule:

```text
look at previous response -> choose next trial
```

This example is the small umbrella pattern for that use case.

Later, a more advanced controller can replace `choose_next_design(...)` with ADOpy, an API call, or any other adaptive method.
