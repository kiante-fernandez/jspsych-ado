// Stan source handling for models registered from source (stanCode / stanUrl):
//   - parseStanPriors derives the engine's JS prior {param:{dist,...}} from the .stan
//     source, so a source-registered model needs no hand-written `prior`.
//   - compileToModuleUrl POSTs the source to a stan-playground compile server and
//     returns the compiled main.js URL.
// Models registered with a precompiled `moduleUrl` (the committed packages) never
// reach either function. Error messages name the façade caller (registerModel /
// prepareModels) since that is where these run from.

// POST a Stan source string to the compile server and return the main.js URL.
async function compileToModuleUrl(stanCode, server, authToken) {
  const base = server.replace(/\/+$/, "");

  let res;
  try {
    res = await fetch(`${base}/compile`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Authorization: `Bearer ${authToken}` },
      body: stanCode,
    });
  } catch (networkError) {
    throw new Error(
      `prepareModels: could not reach the compile server at ${base}. Check the URL/CORS, ` +
        `or run one locally (docker run -p 8083:8080 ghcr.io/flatironinstitute/stan-wasm-server:latest) ` +
        `and pass compileServer:"http://localhost:8083". Original error: ${String(networkError)}`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`prepareModels: compile failed (${res.status}). ${detail}`.trim());
  }
  const payload = await res.json().catch(() => null);
  const model_id = payload && payload.model_id;
  if (!model_id) {
    throw new Error("prepareModels: server response did not include a model_id.");
  }
  return `${base}/download/${model_id}/main.js`;
}

// Derive the engine's JS prior {param:{dist,...}} from the Stan source.
function parseStanPriors(stanCode, paramSpecs) {
  const prior = {};

  // Strip comments first so a commented-out or stale sampling statement
  // (e.g. `// k ~ normal(0,1);`) can't be matched instead of the real prior. (#6)
  const source = stanCode
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/\/\/[^\n]*/g, " "); // line comments

  for (const p of paramSpecs) {
    const name = typeof p === "string" ? p : p.name;
    const meta = typeof p === "string" ? {} : p;

    const declaredPositive =
      meta.lower === 0 ||
      // Match a lower bound of EXACTLY 0 — "lower=0" followed by "," or ">", so a
      // parameter bounded above 0 (`lower=0.5`, `lower=0.1`) isn't misread as 0. (#7)
      new RegExp(`real\\s*<[^>]*lower\\s*=\\s*0\\s*(?:,[^>]*)?>\\s*${name}\\b`).test(source);

    const match = new RegExp(`\\b${name}\\s*~\\s*(\\w+)\\s*\\(([^;]*)\\)\\s*;`).exec(source);
    if (!match) {
      throw new Error(
        `registerModel: no prior found for "${name}" in the Stan source. Add a sampling ` +
          `statement (e.g. ${name} ~ normal(...);) or pass an explicit \`prior\`.`,
      );
    }
    const dist = match[1];
    const args = match[2].split(",").map((s) => Number(s.trim()));
    if (args.some(Number.isNaN)) {
      throw new Error(
        `registerModel: could not read numeric prior arguments for "${name}" ("${match[2].trim()}"). ` +
          `Pass an explicit \`prior\`.`,
      );
    }
    // normal/lognormal each take exactly 2 numeric arguments; a wrong arity would
    // silently leave sd/sdlog undefined and produce NaN prior draws. (#13)
    if ((dist === "normal" || dist === "lognormal") && args.length !== 2) {
      throw new Error(
        `registerModel: "${name}" prior ${dist}(...) expects 2 numeric arguments but got ` +
          `${args.length} ("${match[2].trim()}"). Pass an explicit \`prior\`.`,
      );
    }

    if (dist === "lognormal") {
      prior[name] = { dist: "lognormal", meanlog: args[0], sdlog: args[1] };
    } else if (dist === "normal") {
      if (declaredPositive) {
        if (Math.abs(args[0]) > 1e-9) {
          throw new Error(
            `registerModel: "${name}" is lower-bounded at 0 with a non-zero-mean normal prior ` +
              `(a truncated normal), which the prior sampler can't represent. Pass an explicit ` +
              `\`prior\` (e.g. { dist:"halfnormal", sd:... }).`,
          );
        }
        prior[name] = { dist: "halfnormal", sd: args[1] };
      } else {
        prior[name] = { dist: "normal", mean: args[0], sd: args[1] };
      }
    } else {
      throw new Error(
        `registerModel: unsupported Stan prior "${dist}(...)" for "${name}". Auto-parse supports ` +
          `normal, lognormal, and normal+<lower=0> (half-normal). Pass an explicit \`prior\` for others.`,
      );
    }
  }

  return prior;
}

export { parseStanPriors, compileToModuleUrl };
