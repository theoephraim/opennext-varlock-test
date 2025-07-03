'use strict';

var fs = require('fs');
var zlib = require('zlib');
var http = require('http');
var path = require('path');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var fs__default = /*#__PURE__*/_interopDefault(fs);
var zlib__default = /*#__PURE__*/_interopDefault(zlib);
var path__default = /*#__PURE__*/_interopDefault(path);

// src/plugin.ts

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
    const reqUrl = this.req.url;
    if (runScan && reqUrl && opts?.ignoreUrlPatterns?.some((pattern) => pattern.test(reqUrl))) {
      runScan = false;
    }
    if (!runScan) {
      return serverResponseWrite.apply(this, args);
    }
    const compressionType = this.getHeader("Content-Encoding");
    let chunkStr;
    let chunkType = null;
    if (typeof rawChunk === "string") {
      chunkType = "string";
      chunkStr = rawChunk;
    } else if (!compressionType) {
      chunkType = "encoded";
      const decoder = new TextDecoder();
      chunkStr = decoder.decode(rawChunk);
    } else if (compressionType === "gzip") {
      chunkType = "gzip";
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
        if (opts?.scrub) {
          chunkStr = redactSensitiveConfig(chunkStr);
          if (chunkType === "string") {
            args[0] = chunkStr;
          } else if (chunkType === "encoded") {
            const encoder = new TextEncoder();
            args[0] = encoder.encode(chunkStr);
          } else if (chunkType === "gzip") ; else {
            throw new Error("unable to scrub - unknown chunk type " + chunkType);
          }
        } else {
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
patchConsole();
var IS_WORKER = !!process.env.NEXT_PRIVATE_WORKER;
function debug(...args) {
  if (!process.env.DEBUG_VARLOCK_NEXT_INTEGRATION) return;
  console.log(
    "plugin",
    IS_WORKER ? "[worker] " : "[server]",
    "--",
    ...args
  );
}
debug("\u2728 LOADED @varlock/next-integration/plugin module!");
var scannedStaticFiles = false;
async function scanStaticFiles(nextDirPath) {
  scannedStaticFiles = true;
  for await (const file of fs__default.default.promises.glob(nextDirPath + "/**/*.html")) {
    const fileContents = await fs__default.default.promises.readFile(file, "utf8");
    scanForLeaks(fileContents, { method: "nextjs scan static html files", file });
  }
}
function patchFsWriteFileToScanForLeaks() {
  const origWriteFileFn = fs__default.default.promises.writeFile;
  fs__default.default.promises.writeFile = async function dmnoPatchedWriteFile(...args) {
    const [filePath, fileContents] = arguments;
    if (filePath.endsWith("/.next/next-server.js.nft.json") && !scannedStaticFiles) {
      const nextDirPath = filePath.substring(0, filePath.lastIndexOf("/"));
      await scanStaticFiles(nextDirPath);
    }
    return origWriteFileFn.call(this, ...Array.from(arguments));
  };
}
var WEBPACK_PLUGIN_NAME = "VarlockNextWebpackPlugin";
function varlockNextConfigPlugin(pluginOptions) {
  return (nextConfig) => {
    return async (phase, defaults) => {
      let resolvedNextConfig;
      if (typeof nextConfig === "function") {
        const nextConfigFnResult = nextConfig(phase, defaults);
        resolvedNextConfig = await nextConfigFnResult;
      } else {
        resolvedNextConfig = nextConfig;
      }
      return {
        ...resolvedNextConfig,
        webpack(webpackConfig, options) {
          const { isServer, dev, nextRuntime } = options;
          {
            patchFsWriteFileToScanForLeaks();
            patchServerResponseToPreventClientLeaks({
              ignoreUrlPatterns: [/^\/__nextjs_source-map\?.*/],
              scrub: dev
            });
          }
          const webpack = options.webpack;
          if (resolvedNextConfig.webpack) {
            webpackConfig = resolvedNextConfig.webpack(webpackConfig, options);
          }
          const staticReplacements = {};
          const varlockEnv = JSON.parse(process.env.__VARLOCK_ENV || "{}");
          for (const [key, value] of Object.entries(varlockEnv)) {
            if (!value.isSensitive) {
              staticReplacements[`ENV.${key}`] = JSON.stringify(value.value);
            }
          }
          debug("adding static replacements!", staticReplacements);
          webpackConfig.plugins.push(new webpack.DefinePlugin(staticReplacements));
          webpackConfig.plugins.push({
            apply(compiler) {
              compiler.hooks.assetEmitted.tap(WEBPACK_PLUGIN_NAME, (file, assetDetails) => {
                const { content, targetPath } = assetDetails;
                debug("emit file: ", targetPath);
                if (targetPath.includes("/.next/static/chunks/") || targetPath.endsWith(".html") || targetPath.endsWith(".body") || targetPath.endsWith(".rsc")) {
                  try {
                    scanForLeaks(content, {
                      method: "@varlock/nextjs-integration/plugin - assetEmitted hook",
                      file: targetPath
                    });
                  } catch (err) {
                    if (dev) {
                      fs__default.default.writeFileSync(targetPath, redactSensitiveConfig(content.toString()));
                    } else {
                      throw err;
                    }
                  }
                }
              });
            }
          });
          function injectVarlockInitIntoWebpackRuntime(edgeRuntime = false) {
            return function(origSource) {
              const origSourceStr = origSource.source();
              const injectorPath = path__default.default.resolve(__dirname, "./injector.js");
              const injectorSrc = fs__default.default.readFileSync(injectorPath, "utf8");
              const updatedSourceStr = [
                // we use `headers()` to force next into dynamic rendering mode, but on the edge runtime it's always dynamic
                // (see below for where headers is used)
                // !edgeRuntime ? 'const { headers } = require("next/headers");' : '',
                // // code built for edge runtime does not have `module.exports` or `exports` but we are inlining some already built common-js code
                // // so we just create them. It's not needed since it is inlined and we call the function right away
                // edgeRuntime ? 'const module = { exports: {} }; const exports = {}' : '',
                // inline the dmno injector code and then call it
                injectorSrc,
                // 'injectDmnoGlobals({',
                // injectResolvedConfigAtBuildTime ? `injectedConfig: ${JSON.stringify(injectedDmnoEnv)},` : '',
                // // attempts to force the route into dynamic rendering mode so it wont put our our dynamic value into a pre-rendered page
                // // however we have to wrap in try/catch because you can only call headers() within certain parts of the page... so it's not 100% foolproof
                // !edgeRuntime ? `
                //   onItemAccess: async (item) => {
                //     if (item.dynamic) {
                //       try { headers(); }
                //       catch (err) {}
                //     }
                //   },` : '',
                // '});',
                origSourceStr
              ].join("\n");
              return new webpack.sources.RawSource(updatedSourceStr);
            };
          }
          webpackConfig.plugins.push({
            apply(compiler) {
              compiler.hooks.thisCompilation.tap(WEBPACK_PLUGIN_NAME, (compilation) => {
                compilation.hooks.processAssets.tap(
                  {
                    name: WEBPACK_PLUGIN_NAME,
                    stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
                  },
                  () => {
                    if (compilation.getAsset("webpack-runtime.js")) {
                      compilation.updateAsset("webpack-runtime.js", injectVarlockInitIntoWebpackRuntime());
                    }
                    if (compilation.getAsset("../webpack-runtime.js")) {
                      compilation.updateAsset("../webpack-runtime.js", injectVarlockInitIntoWebpackRuntime());
                    }
                    if (compilation.getAsset("webpack-api-runtime.js")) {
                      compilation.updateAsset("webpack-api-runtime.js", injectVarlockInitIntoWebpackRuntime());
                    }
                    if (compilation.getAsset("../webpack-api-runtime.js")) {
                      compilation.updateAsset("../webpack-api-runtime.js", injectVarlockInitIntoWebpackRuntime());
                    }
                    if (compilation.getAsset("edge-runtime-webpack.js")) {
                      compilation.updateAsset("edge-runtime-webpack.js", injectVarlockInitIntoWebpackRuntime(true));
                    }
                  }
                );
              });
            }
          });
          return webpackConfig;
        }
      };
    };
  };
}

exports.varlockNextConfigPlugin = varlockNextConfigPlugin;
//# sourceMappingURL=plugin.js.map
//# sourceMappingURL=plugin.js.map