/* eslint-disable prefer-rest-params */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
// import { injectDmnoGlobals } from 'dmno/injector-standalone';
// import { resolve } from 'import-meta-resolve';
import type { NextConfig } from 'next';
// import { getBuildTimeReplacements, patchServerResponseToPreventClientLeaks, scanForLeaks } from 'varlock';

import { redactSensitiveConfig, scanForLeaks } from './runtime';
import { patchServerResponseToPreventClientLeaks } from './patch-server-response';
import { patchConsole } from './patch-console';
import path from 'node:path';

patchConsole();

const IS_WORKER = !!process.env.NEXT_PRIVATE_WORKER;
function debug(...args: Array<any>) {
  if (!process.env.DEBUG_VARLOCK_NEXT_INTEGRATION) return;
  console.log(
    'plugin',
    IS_WORKER ? '[worker] ' : '[server]',
    '--',
    ...args,
  );
}
debug('✨ LOADED @varlock/next-integration/plugin module!');

const ENABLE_LEAK_DETECTION = true;

// const {
//   staticReplacements, dynamicKeys, injectedDmnoEnv, serviceSettings,
// } = injectDmnoGlobals();

type VarlockPluginOptions = {
  // injectResolvedConfigAtBuildTime: boolean,
};



let scannedStaticFiles = false;
async function scanStaticFiles(nextDirPath: string) {
  scannedStaticFiles = true;
  for await (const file of fs.promises.glob(nextDirPath + '/**/*.html')) {
    const fileContents = await fs.promises.readFile(file, 'utf8');
    scanForLeaks(fileContents, { method: 'nextjs scan static html files', file });
  }
}

// this seems to not catch anything in next 15 - as it only covers manifest files
// but it can't hurt to add it
function patchFsWriteFileToScanForLeaks() {
  // patch fs.promises.writeFile
  const origWriteFileFn = fs.promises.writeFile;  
  fs.promises.writeFile = async function dmnoPatchedWriteFile(...args) {
    const [filePath, fileContents] = arguments;
    // console.log('⚡️ patched fs.promises.writeFile', filePath);

    if (filePath.endsWith('/.next/next-server.js.nft.json') && !scannedStaticFiles) {
      const nextDirPath = (filePath as string).substring(0, filePath.lastIndexOf('/'));
      await scanStaticFiles(nextDirPath);
    }

    // // naively enable/disable detection based on file extension... probably not the best logic but it might be enough?
    // if (
    //   filePath.endsWith('.html')
    //   || filePath.endsWith('.rsc')
    //   || filePath.endsWith('.body')
    //   // we also need to scan .js files, but they are already built by webpack so we can't catch it here
    // ) {
    //   // TODO: better error details to help user _find_ the problem
    //   scanForLeaks(fileContents, { method: 'nextjs fs.writeFile', file: filePath });
    // }

    // @ts-ignore
    return origWriteFileFn.call(this, ...Array.from(arguments));
  };

  // // patch fs.promises.copyFile
  // const origCopyFileFn = fs.promises.copyFile;  
  // // @ts-ignore
  // fs.promises.copyFile = function dmnoPatchedCopyFile(...args) {
  //   const [srcPath, destPath] = arguments;
  //   console.log('⚡️ patched fs.promises.copyFile', srcPath, destPath);
  //   // @ts-ignore
  //   return origCopyFileFn.call(this, ...Array.from(arguments));
  // }

  // for (const [fnName, origFn] of Object.entries(fs.promises)) {
  //   (fs.promises as any)[fnName] = function (...args: any[]) {
  //     console.log('⚡️ patched fs.promises -- ', fnName, args[0]);
  //     // @ts-ignore
  //     return origFn.call(this, ...Array.from(arguments));
  //   }
  // }
  // for (const [fnName, origFn] of Object.entries(fs)) {
  //   if (typeof origFn !== 'function') continue;
  //   (fs as any)[fnName] = function (...args: any[]) {
  //     console.log('⚡️ patched fs -- ', fnName, args[0]);
  //     // @ts-ignore
  //     return origFn.call(this, ...Array.from(arguments));
  //   }
  // }


  // const origWriteFileFn = fs.writeFile;  
  // // @ts-ignore
  // fs.writeFile = function dmnoPatchedWriteFile(...args) {
  //   const [filePath, fileContents] = arguments;
  //   console.log('⚡️ patched fs.writeFile', filePath);
  //   // @ts-ignore
  //   return origWriteFileFn.call(this, ...Array.from(arguments));
  // }


  // const origWriteFileSyncFn = fs.writeFileSync;  
  // // @ts-ignore
  // fs.writeFileSync = function dmnoPatchedWriteFileSync(...args) {
  //   const [filePath, fileContents] = arguments;
  //   console.log('⚡️ patched fs.writeFileSync', filePath);
  //   // @ts-ignore
  //   return origWriteFileSyncFn.call(this, ...Array.from(arguments));
  // }
}



export type NextConfigFunction = (
  phase: string,
  defaults: { defaultConfig: NextConfig },
) => NextConfig | PromiseLike<NextConfig>;



const WEBPACK_PLUGIN_NAME = 'VarlockNextWebpackPlugin';

// function getCjsModuleSource(moduleName: string) {
//   const modulePath = fileURLToPath(resolve(moduleName, import.meta.url)).replace('.js', '.cjs');
//   const moduleSrc = fs.readFileSync(modulePath, 'utf8');
//   return moduleSrc;
// }

// function getCjsModuleSource(moduleName: string) {
  
//   require.resolve(moduleName);

//   const modulePath = fileURLToPath(resolve(moduleName, import.meta.url)).replace('.js', '.cjs');
//   const moduleSrc = fs.readFileSync(modulePath, 'utf8');
//   return moduleSrc;
// }

// we make this a function because we'll likely end up adding some options
export function varlockNextConfigPlugin(pluginOptions?: VarlockPluginOptions) {
  // nextjs doesnt have a proper plugin system, so we write a function which takes in a config object and returns an augmented one
  return (nextConfig: any | NextConfig | NextConfigFunction): NextConfigFunction => {
    return async (phase: string, defaults: { defaultConfig: NextConfig }) => {
      let resolvedNextConfig: NextConfig;
      if (typeof nextConfig === 'function') {
        const nextConfigFnResult = nextConfig(phase, defaults);
        resolvedNextConfig = await nextConfigFnResult;
      } else {
        resolvedNextConfig = nextConfig;
      }

      return {
        ...resolvedNextConfig,
        webpack(webpackConfig, options) {
          const { isServer, dev, nextRuntime } = options;


          if (ENABLE_LEAK_DETECTION) {
            // patches fs.writeFile to scan files output by next itself for leaks
            // (does not include files output during webpack build)
            patchFsWriteFileToScanForLeaks();

            // have to wait until here when we know if this is dev mode or not
            patchServerResponseToPreventClientLeaks({
              ignoreUrlPatterns: [/^\/__nextjs_source-map\?.*/],
              scrub: dev,
            });
          }

          // webpack itself  is passed in so we dont have to import it...
          const webpack = options.webpack;

          // apply existing user customizations if there are any
          if (resolvedNextConfig.webpack) {
            webpackConfig = resolvedNextConfig.webpack(webpackConfig, options);
          }


          // Set up build-time replacements / rewrites (using webpack.DefinePlugin)
          const staticReplacements = {} as Record<string, string>; // getBuildTimeReplacements({
          const varlockEnv = JSON.parse(process.env.__VARLOCK_ENV || '{}') as Record<string, { value: string, isSensitive: boolean }>;
          for (const [key, value] of Object.entries(varlockEnv)) {
            if (!value.isSensitive) {
              staticReplacements[`ENV.${key}`] = JSON.stringify(value.value);
            }
          }

          debug('adding static replacements!', staticReplacements);
          webpackConfig.plugins.push(new webpack.DefinePlugin(staticReplacements));

          webpackConfig.plugins.push({
            apply(compiler: any) {
              compiler.hooks.assetEmitted.tap(WEBPACK_PLUGIN_NAME, (file: any, assetDetails: any) => {
                const { content, targetPath } = assetDetails;
                debug('emit file: ', targetPath);

                if (
                  targetPath.includes('/.next/static/chunks/')
                  || targetPath.endsWith('.html')
                  || targetPath.endsWith('.body')
                  || targetPath.endsWith('.rsc')
                ) {
                  // NOTE - in dev mode the request hangs on the error, but the console error should help
                  // and during a build, it will actually fail the build
                  try {
                    scanForLeaks(content, {
                      method: '@varlock/nextjs-integration/plugin - assetEmitted hook',
                      file: targetPath,
                    });
                  } catch (err) {
                    if (dev) {
                      // overwrite file with redacted version
                      fs.writeFileSync(targetPath, redactSensitiveConfig(content.toString()));
                    } else {
                      throw err;
                    }
                  }
                }
              });
            },
          });




          // we need to inject the dmno globals injector and call it
          // and in vercel/netlify etc where we can't run via `dmno run` we need to inject the resolved config into the build
          // not sure if this is the best way, but injecting into the `webpack-runtime.js` file seems to run everywhere

          // updates the webpack source to inject dmno global logic and call it
          // we run this on the runtimes for serverless and edge
          function injectVarlockInitIntoWebpackRuntime(edgeRuntime = false) {
            return function (origSource: any) {
              const origSourceStr = origSource.source();

              // we will inline the injector code, but need a different version if we are running in the edge runtime
              // const injectorSrc = getCjsModuleSource(`dmno/injector-standalone${edgeRuntime ? '/edge' : ''}`);
              const injectorPath = path.resolve(__dirname, './injector.js');
              const injectorSrc = fs.readFileSync(injectorPath, 'utf8');
              

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

                origSourceStr,
              ].join('\n');

              return new webpack.sources.RawSource(updatedSourceStr);
            };
          }

          webpackConfig.plugins.push({
            apply(compiler: any) {
              compiler.hooks.thisCompilation.tap(WEBPACK_PLUGIN_NAME, (compilation: any) => {
                compilation.hooks.processAssets.tap(
                  {
                    name: WEBPACK_PLUGIN_NAME,
                    stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
                  },
                  () => {
                    // not sure why, but these paths are different in build vs dev
                    if (compilation.getAsset('webpack-runtime.js')) {
                      compilation.updateAsset('webpack-runtime.js', injectVarlockInitIntoWebpackRuntime());
                    }
                    if (compilation.getAsset('../webpack-runtime.js')) {
                      compilation.updateAsset('../webpack-runtime.js', injectVarlockInitIntoWebpackRuntime());
                    }
                    if (compilation.getAsset('webpack-api-runtime.js')) {
                      compilation.updateAsset('webpack-api-runtime.js', injectVarlockInitIntoWebpackRuntime());
                    }
                    if (compilation.getAsset('../webpack-api-runtime.js')) {
                      compilation.updateAsset('../webpack-api-runtime.js', injectVarlockInitIntoWebpackRuntime());
                    }

                    if (compilation.getAsset('edge-runtime-webpack.js')) {
                      compilation.updateAsset('edge-runtime-webpack.js', injectVarlockInitIntoWebpackRuntime(true));
                    }
                  },
                );
              });
            }

          });

          return webpackConfig; // must return the modified config
        },
      };
    };
  };
}
