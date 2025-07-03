'use strict';

var zlib = require('zlib');
var http = require('http');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var zlib__default = /*#__PURE__*/_interopDefault(zlib);

// src/runtime.ts
var UNMASK_STR = "\u{1F441}";
function redactString(valStr, mode, hideLength = true) {
  if (!valStr) return valStr;
  const hiddenLength = hideLength ? 5 : valStr.length - 2;
  const hiddenStr = "\u2592".repeat(hiddenLength);
  {
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
new Proxy({}, {
  get(target, prop) {
    if (typeof prop !== "string") throw new Error("prop keys cannot be symbols");
    return envValues[prop];
  }
});

// src/patch-console.ts
function patchConsole() {
  console.log("\u26A1\uFE0F PATCHING CONSOLE!");
  const kWriteToConsoleSymbol = Object.getOwnPropertySymbols(globalThis.console).find((s) => s.description === "kWriteToConsole");
  globalThis._varlockOrigWriteToConsoleFn ||= globalThis.console[kWriteToConsoleSymbol];
  globalThis.console[kWriteToConsoleSymbol] = function() {
    globalThis._varlockOrigWriteToConsoleFn.apply(this, [
      arguments[0],
      redactSensitiveConfig(arguments[1]),
      arguments[2]
    ]);
  };
  if (
    // !console.log.toString().includes('[native code]') &&
    !console.log._varlockPatchedFn
  ) {
    for (const logMethodName of ["trace", "debug", "info", "log", "info", "warn", "error"]) {
      const originalLogMethod = globalThis.console[logMethodName];
      const patchedFn = function() {
        originalLogMethod.apply(this, Array.from(arguments).map(redactSensitiveConfig));
      };
      patchedFn._varlockPatchedFn = true;
      globalThis.console[logMethodName] = patchedFn;
    }
  }
}
var patchedKey = "_patchedByVarlock";
function patchServerResponseToPreventClientLeaks(opts) {
  console.log("\u26A1\uFE0F patching ServerResponse");
  if (Object.getOwnPropertyDescriptor(http.ServerResponse.prototype, patchedKey)) {
    console.log("> already patched");
    return;
  }
  Object.defineProperty(http.ServerResponse.prototype, patchedKey, { value: true });
  const serverResponseWrite = http.ServerResponse.prototype.write;
  http.ServerResponse.prototype.write = function varlockPatchedServerResponseWrite(...args) {
    console.log("\u26A1\uFE0F patched ServerResponse.write");
    const rawChunk = args[0];
    const contentType = this.getHeader("content-type")?.toString() || "";
    let runScan = contentType.startsWith("text/") || contentType.startsWith("application/json");
    this.req.url;
    if (!runScan) {
      return serverResponseWrite.apply(this, args);
    }
    const compressionType = this.getHeader("Content-Encoding");
    let chunkStr;
    if (typeof rawChunk === "string") {
      chunkStr = rawChunk;
    } else if (!compressionType) {
      const decoder = new TextDecoder();
      chunkStr = decoder.decode(rawChunk);
    } else if (compressionType === "gzip") {
      if (!this._zlibChunks) {
        this._zlibChunks = [rawChunk];
      } else {
        this._zlibChunks?.push(rawChunk);
        try {
          const unzippedChunk = zlib__default.default.unzipSync(Buffer.concat(this._zlibChunks || []), {
            flush: zlib__default.default.constants.Z_SYNC_FLUSH,
            finishFlush: zlib__default.default.constants.Z_SYNC_FLUSH
          });
          const fullUnzippedData = unzippedChunk.toString("utf-8");
          chunkStr = fullUnzippedData.substring(this._lastChunkEndIndex || 0);
          this._lastChunkEndIndex = fullUnzippedData.length;
        } catch (err) {
        }
      }
    }
    if (chunkStr) {
      try {
        scanForLeaks(chunkStr, { method: "patched ServerResponse.write", file: this.req.url });
      } catch (err) {
        {
          throw err;
        }
      }
    }
    return serverResponseWrite.apply(this, args);
  };
  const serverResponseEnd = http.ServerResponse.prototype.end;
  http.ServerResponse.prototype.end = function patchedServerResponseEnd(...args) {
    const endChunk = args[0];
    if (endChunk && typeof endChunk === "string") {
      scanForLeaks(endChunk, { method: "patched ServerResponse.end" });
    }
    return serverResponseEnd.apply(this, args);
  };
}

// src/patch-response.ts
function patchResponseToPreventClientLeaks() {
  var _a;
  if (!globalThis.Response._patchedByVarlock) {
    console.log("\u26A1\uFE0Fpatching Response");
    const _UnpatchedResponse = globalThis.Response;
    globalThis.Response = (_a = class extends _UnpatchedResponse {
      constructor(body, init) {
        super(scanForLeaks(body, { method: "patched Response constructor" }), init);
      }
      static json(data, init) {
        scanForLeaks(JSON.stringify(data), { method: "patched Response.json" });
        const r = _UnpatchedResponse.json(data, init);
        Object.setPrototypeOf(r, Response.prototype);
        return r;
      }
    }, _a._patchedByVarlock = true, _a);
  }
}

// src/injector.ts
patchConsole();
patchServerResponseToPreventClientLeaks();
patchResponseToPreventClientLeaks();
//# sourceMappingURL=injector.js.map
//# sourceMappingURL=injector.js.map