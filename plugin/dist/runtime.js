'use strict';

// src/runtime.ts
var UNMASK_STR = "\u{1F441}";
function redactString(valStr, mode, hideLength = true) {
  if (!valStr) return valStr;
  const hiddenLength = hideLength ? 5 : valStr.length - 2;
  const hiddenStr = "\u2592".repeat(hiddenLength);
  if (mode === "show_last_2") {
    return `${hiddenStr}${valStr.substring(valStr.length - 2, valStr.length)}`;
  } else if (mode === "show_first_last") {
    return `${valStr.substring(0, 1)}${hiddenStr}${valStr.substring(valStr.length - 1, valStr.length)}`;
  } else {
    return `${valStr.substring(0, 2)}${hiddenStr}`;
  }
}
var sensitiveSecretsMap = {};
var redactorFindReplace;
function resetRedactionMap(graph) {
  sensitiveSecretsMap = {};
  for (const itemKey in graph.config) {
    const item = graph.config[itemKey];
    if (item.isSensitive && item.value && isString(item.value)) {
      const redacted = redactString(item.value);
      if (redacted) sensitiveSecretsMap[item.value] = { key: itemKey, redacted };
    }
  }
  const findRegex = new RegExp(
    [
      `(${UNMASK_STR} )?`,
      "(",
      Object.keys(sensitiveSecretsMap).map((s) => s.replace(/[()[\]{}*+?^$|#.,/\\\s-]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|"),
      ")",
      `( ${UNMASK_STR})?`
    ].join(""),
    "g"
  );
  const replaceFn = (match, pre, val, post) => {
    if (pre && post) return match;
    return sensitiveSecretsMap[val].redacted;
  };
  redactorFindReplace = { find: findRegex, replace: replaceFn };
}
function redactSensitiveConfig(o) {
  if (!redactorFindReplace) return o;
  if (!o) return o;
  if (Array.isArray(o)) {
    return o.map(redactSensitiveConfig);
  }
  if (o && typeof o === "object" && Object.getPrototypeOf(o) === Object.prototype) {
    try {
      return JSON.parse(redactSensitiveConfig(JSON.stringify(o)));
    } catch (err) {
      return o;
    }
  }
  const type = typeof o;
  if (type === "string" || type === "object" && Object.prototype.toString.call(o) === "[object String]") {
    return o.replaceAll(redactorFindReplace.find, redactorFindReplace.replace);
  }
  return o;
}
function revealSensitiveConfig(secretStr) {
  if (!globalThis._varlockOrigWriteToConsoleFn) return secretStr;
  return `${UNMASK_STR} ${secretStr} ${UNMASK_STR}`;
}
function isString(s) {
  return Object.prototype.toString.call(s) === "[object String]";
}
function scanForLeaks(toScan, meta) {
  function scanStrForLeaks(strToScan) {
    for (const sensitiveValue in sensitiveSecretsMap) {
      if (strToScan.includes(sensitiveValue)) {
        const itemKey = sensitiveSecretsMap[sensitiveValue].key;
        console.error([
          "",
          `\u{1F6A8} ${"DETECTED LEAKED SENSITIVE CONFIG"} \u{1F6A8}`,
          `> Config item key: ${itemKey}`,
          ...meta?.method ? [`> Scan method: ${meta.method}`] : [],
          ...meta?.file ? [`> File: ${meta.file}`] : [],
          ""
        ].join("\n"));
        throw new Error(`\u{1F6A8} DETECTED LEAKED SENSITIVE CONFIG - ${itemKey}`);
      }
    }
  }
  if (isString(toScan)) {
    scanStrForLeaks(toScan);
    return toScan;
  } else if (toScan instanceof Buffer) {
    scanStrForLeaks(toScan.toString());
    return toScan;
  } else if (toScan instanceof ReadableStream) {
    if (toScan.locked) {
      return toScan;
    }
    const chunkDecoder = new TextDecoder();
    return toScan.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          const chunkStr = chunkDecoder.decode(chunk);
          scanStrForLeaks(chunkStr);
          controller.enqueue(chunk);
        }
      })
    );
  }
  return toScan;
}
var initializedEnv = false;
var envValues = {};
console.log("LOADED ENV RUNTIME - initialized?", initializedEnv);
function initVarlockEnv() {
  console.log("\u26A1\uFE0F INIT VARLOCK ENV!");
  try {
    const serializedEnvData = JSON.parse(process.env.__VARLOCK_ENV || "{}");
    resetRedactionMap({ config: serializedEnvData });
    for (const [key, value] of Object.entries(serializedEnvData)) {
      envValues[key] = value.value;
    }
  } catch (err) {
    console.error("failed to load varlock env", err, process.env.__VARLOCK_ENV);
  }
  initializedEnv = true;
}
if (process.env.__VARLOCK_ENV && !initializedEnv) initVarlockEnv();
var EnvProxy = new Proxy({}, {
  get(target, prop) {
    if (typeof prop !== "string") throw new Error("prop keys cannot be symbols");
    return envValues[prop];
  }
});
var ENV = EnvProxy;

exports.ENV = ENV;
exports.initVarlockEnv = initVarlockEnv;
exports.redactSensitiveConfig = redactSensitiveConfig;
exports.redactString = redactString;
exports.resetRedactionMap = resetRedactionMap;
exports.revealSensitiveConfig = revealSensitiveConfig;
exports.scanForLeaks = scanForLeaks;
//# sourceMappingURL=runtime.js.map
//# sourceMappingURL=runtime.js.map