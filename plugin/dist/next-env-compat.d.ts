/**
 * Drop-in replacement for @next/env that uses varlock instead of dotenv
 *
 * This must be the default export of the module, and it must stay compatible with @next/env
 */
type Env = {
    [key: string]: string | undefined;
};
type LoadedEnvFiles = Array<{
    path: string;
    contents: string;
    env: Env;
}>;
/** will store the original values of process.env */
declare let initialEnv: Env | undefined;
declare function updateInitialEnv(newEnv: Env): void;
type Log = {
    info: (...args: Array<any>) => void;
    error: (...args: Array<any>) => void;
};
declare function processEnv(_loadedEnvFiles: LoadedEnvFiles, _dir?: string, _log?: Log, _forceReload?: boolean, _onReload?: (envFilePath: string) => void): NodeJS.ProcessEnv[];
declare function resetEnv(): void;
declare function loadEnvConfig(dir: string, dev?: boolean, log?: Log, forceReload?: boolean, onReload?: (envFilePath: string) => void): {
    combinedEnv: Env;
    parsedEnv: Env | undefined;
    loadedEnvFiles: LoadedEnvFiles;
};

export { type Env, type LoadedEnvFiles, initialEnv, loadEnvConfig, processEnv, resetEnv, updateInitialEnv };
