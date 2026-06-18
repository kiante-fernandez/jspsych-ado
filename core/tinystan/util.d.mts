import { a as StanVariableInputs, n as PrintCallback } from "./types-BxjbB-KD.mjs";

//#region src/util.d.ts
declare const prepareStanJSON: (obj: string | StanVariableInputs) => string;
declare const printCallbackSponge: () => {
  printCallback: PrintCallback;
  getStdout: () => string;
  clearStdout: () => void;
};
//#endregion
export { prepareStanJSON, printCallbackSponge };