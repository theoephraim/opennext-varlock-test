/**
 * Drop-in replacement for @next/env that uses varlock instead of dotenv
 *
 * This must be the default export of the module, and it must stay compatible with @next/env
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, type spawnSync } from 'child_process';
// import { VarlockRedactor, resetRedactionMap, type SerializedEnvGraph } from 'varlock';

export type Env = { [key: string]: string | undefined };
export type LoadedEnvFiles = Array<{
  path: string
  contents: string
  env: Env
}>;

/** will store the original values of process.env */
export let initialEnv: Env | undefined;

let lastReloadAt: Date | undefined;

let combinedEnv: Env | undefined;
let parsedEnv: Env | undefined;
// this is used by next just to display the list of .env files in a startup log
let loadedEnvFiles: LoadedEnvFiles = [];

const IS_WORKER = !!process.env.NEXT_PRIVATE_WORKER;
function debug(...args: Array<any>) {
  if (false && !process.env.DEBUG_VARLOCK_NEXT_INTEGRATION) return;
  console.log(
    IS_WORKER ? 'worker -- ' : 'server -- ',
    ...args,
  );
}
debug('✨ LOADED @next/env module!');


// Next.js only watches .env, .env.local, .env.development, .env.development.local
// but we want to trigger reloads when .env.schema changes
// so we set up an extra watcher, and trigger no-op changes to one of those files
let extraWatcherEnabled = false;
const NEXT_WATCHED_ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local'];
function enableExtraFileWatchers(dir: string) {
  if (extraWatcherEnabled || IS_WORKER) return;
  extraWatcherEnabled = true;

  const envSchemaPath = path.join(dir, '.env.schema');
  // its faster to update an existing file, so we check if the user has any
  // otherwise we can create and destroy
  let envFilePathToUpdate: string | null = null;
  for (const envFileName of NEXT_WATCHED_ENV_FILES) {
    const filePath = path.join(dir, envFileName);
    if (fs.existsSync(filePath)) {
      envFilePathToUpdate = filePath;
      break;
    }
  }
  let destroyFile = false;
  if (!envFilePathToUpdate) {
    envFilePathToUpdate ||= path.join(dir, '.env');
    destroyFile = true;
  }

  debug('set up extra file watchers', envFilePathToUpdate, destroyFile);

  fs.watchFile(envSchemaPath, { interval: 500 }, (curr, prev) => {
    if (destroyFile) {
      fs.writeFileSync(envFilePathToUpdate, '# trigger reload', 'utf-8');
      setTimeout(() => {
        fs.unlinkSync(envFilePathToUpdate);
      }, 500);
    } else {
      const currentContents = fs.readFileSync(envFilePathToUpdate, 'utf-8');
      fs.writeFileSync(envFilePathToUpdate, currentContents, 'utf-8');
    }
  });
}




export function updateInitialEnv(newEnv: Env) {
  if (Object.keys(newEnv).length) {
    debug('updateInitialEnv', newEnv);
    Object.assign(initialEnv || {}, newEnv);
  }
}

type Log = {
  info: (...args: Array<any>) => void
  error: (...args: Array<any>) => void
};

function replaceProcessEnv(sourceEnv: Env) {
  Object.keys(process.env).forEach((key) => {
    // Allow mutating internal Next.js env variables after the server has initiated.
    // This is necessary for dynamic things like the IPC server port.
    if (!key.startsWith('__NEXT_PRIVATE')) {
      if (sourceEnv[key] === undefined || sourceEnv[key] === '') {
        delete process.env[key];
      }
    }
  });

  Object.entries(sourceEnv).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

// in original module, but does not appear to be used
export function processEnv(
  _loadedEnvFiles: LoadedEnvFiles,
  _dir?: string,
  _log: Log = console,
  _forceReload = false,
  _onReload?: (envFilePath: string) => void,
) {
  return [process.env];
}

export function resetEnv() {
  if (initialEnv) {
    replaceProcessEnv(initialEnv);
  }
}

let varlockEnv;

export function loadEnvConfig(
  dir: string,
  dev?: boolean,
  log: Log = console,
  forceReload = false,
  onReload?: (envFilePath: string) => void,
): {
    combinedEnv: Env
    parsedEnv: Env | undefined
    loadedEnvFiles: LoadedEnvFiles
  } {
  if (!initialEnv) {
    initialEnv ||= { ...process.env };
  }
  debug('loadEnvConfig!', 'forceReload = ', forceReload);
  // Reload, 'dir = ', dir, 'dev = ', dev, 'onReload = ', onReload);

  resetEnv();

  varlockEnv = {
    SECRET_FOO: { value: 'secret-foo', isSensitive: true },
    NEXT_PUBLIC_FOO: { value: 'next-public-foo', isSensitive: false },
    PUBLIC_FOO: { value: 'public-foo', isSensitive: false },
    OVERRIDE_FROM_ENV_SPECIFIC_FILE: { value: 'override-me', isSensitive: false },
    SECRET_OVERRIDE_FROM_ENV_SPECIFIC_FILE: { value: 'sensitive-override-me', isSensitive: true },
  }
  process.env.__VARLOCK_ENV = JSON.stringify(varlockEnv);

  parsedEnv = {};
  let dotEnvStr = '';
  for (const [key, value] of Object.entries(varlockEnv)) {
    parsedEnv[key] = value.value;
    dotEnvStr += `${key}=${JSON.stringify(value.value)}\n`;

    process.env[key] = value.value;
  }
  dotEnvStr += `__VARLOCK_ENV=${JSON.stringify(varlockEnv)}\n`;


  // if we are building on vercel, we'll output our resolved env to .env.local
  // because vercel won't actually call this loader in produciton except during the build
  console.log('process.env', process.env);

  if (process.env.VERCEL || process.env.WORKERS_CI || true) {
    // console.log('writing new .env.local file');
    // fs.writeFileSync(path.join(dir, '.env.local'), dotEnvStr, 'utf-8');
    fs.writeFileSync(path.join(dir, '.env.production.local'), dotEnvStr, 'utf-8');
  }


  combinedEnv = {
    ...initialEnv,
    ...parsedEnv,
  };
  loadedEnvFiles = [{
    path: 'injected1',
    contents: '',
    env: {},
  }];

  return { combinedEnv, parsedEnv, loadedEnvFiles };
}
