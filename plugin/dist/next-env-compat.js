'use strict';

var fs = require('fs');
var path = require('path');

function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n.default = e;
  return Object.freeze(n);
}

var fs__namespace = /*#__PURE__*/_interopNamespace(fs);
var path__namespace = /*#__PURE__*/_interopNamespace(path);

// src/next-env-compat.ts
exports.initialEnv = void 0;
var combinedEnv;
var parsedEnv;
var loadedEnvFiles = [];
var IS_WORKER = !!process.env.NEXT_PRIVATE_WORKER;
function debug(...args) {
  console.log(
    IS_WORKER ? "worker -- " : "server -- ",
    ...args
  );
}
debug("\u2728 LOADED @next/env module!");
function updateInitialEnv(newEnv) {
  if (Object.keys(newEnv).length) {
    debug("updateInitialEnv", newEnv);
    Object.assign(exports.initialEnv || {}, newEnv);
  }
}
function replaceProcessEnv(sourceEnv) {
  Object.keys(process.env).forEach((key) => {
    if (!key.startsWith("__NEXT_PRIVATE")) {
      if (sourceEnv[key] === void 0 || sourceEnv[key] === "") {
        delete process.env[key];
      }
    }
  });
  Object.entries(sourceEnv).forEach(([key, value]) => {
    process.env[key] = value;
  });
}
function processEnv(_loadedEnvFiles, _dir, _log = console, _forceReload = false, _onReload) {
  return [process.env];
}
function resetEnv() {
  if (exports.initialEnv) {
    replaceProcessEnv(exports.initialEnv);
  }
}
var varlockEnv;
function loadEnvConfig(dir, dev, log = console, forceReload = false, onReload) {
  if (!exports.initialEnv) {
    exports.initialEnv ||= { ...process.env };
  }
  debug("loadEnvConfig!", "forceReload = ", forceReload);
  resetEnv();
  varlockEnv = {
    SECRET_FOO: { value: "secret-foo", isSensitive: true },
    NEXT_PUBLIC_FOO: { value: "next-public-foo", isSensitive: false },
    PUBLIC_FOO: { value: "public-foo", isSensitive: false },
    OVERRIDE_FROM_ENV_SPECIFIC_FILE: { value: "override-me", isSensitive: false },
    SECRET_OVERRIDE_FROM_ENV_SPECIFIC_FILE: { value: "sensitive-override-me", isSensitive: true }
  };
  process.env.__VARLOCK_ENV = JSON.stringify(varlockEnv);
  parsedEnv = {};
  let dotEnvStr = "";
  for (const [key, value] of Object.entries(varlockEnv)) {
    parsedEnv[key] = value.value;
    dotEnvStr += `${key}=${JSON.stringify(value.value)}
`;
    process.env[key] = value.value;
  }
  dotEnvStr += `__VARLOCK_ENV=${JSON.stringify(varlockEnv)}
`;
  console.log("process.env", process.env);
  if (process.env.VERCEL || process.env.WORKERS_CI || true) {
    fs__namespace.writeFileSync(path__namespace.join(dir, ".env.production.local"), dotEnvStr, "utf-8");
  }
  combinedEnv = {
    ...exports.initialEnv,
    ...parsedEnv
  };
  loadedEnvFiles = [{
    path: "injected1",
    contents: "",
    env: {}
  }];
  return { combinedEnv, parsedEnv, loadedEnvFiles };
}

exports.loadEnvConfig = loadEnvConfig;
exports.processEnv = processEnv;
exports.resetEnv = resetEnv;
exports.updateInitialEnv = updateInitialEnv;
//# sourceMappingURL=next-env-compat.js.map
//# sourceMappingURL=next-env-compat.js.map