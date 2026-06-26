// Type-level smoke test for the public declarations (src/index.d.ts).
//
// Exercised by `npm run typecheck` (tsc --noEmit); never executed at runtime. It imports
// from the package name so it also proves the package.json `types` field + `.` export
// condition resolve a consumer's `import ... from "jspsych-ado"` to the declarations.

import ado, {
  registerTask,
  registerModelPackage,
  createTimeline,
  arange,
  linspace,
} from "jspsych-ado";
import type { TaskPackage, ModelPackage, CreateTimelineConfig } from "jspsych-ado";

// The default export carries the façade methods.
ado.registerTask;
ado.createTimeline;

const task: TaskPackage = {
  id: "demo",
  design_grid: { amount: [1, 2, 3] },
  designKeys: ["amount"],
  responseSpace: { type: "binary" },
  presentation: () => [],
};
registerTask("demo", task);

declare const model: ModelPackage;
const modelName: string = registerModelPackage(model, { n_trials: 10 });

const config: CreateTimelineConfig = {
  task: "demo",
  model: modelName,
  design_strategy: "ado",
  stopping: { eig_fraction: 0.1, min_trials: 8 },
};

declare const jsPsych: unknown;
const timeline = createTimeline(jsPsych, config);
timeline.length; // a spreadable jsPsych timeline fragment

const axis: number[] = arange(0, 10, 2);
const points: number[] = linspace(0, 1, 5);
void axis;
void points;
