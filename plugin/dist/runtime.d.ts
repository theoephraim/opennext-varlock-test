type RedactMode = 'show_first_2' | 'show_last_2' | 'show_first_last';
/**
 * utility to mask/redact a string, for example transforming "hello" into "he▒▒▒"
 * this function just redacts _any_ string passed in
 *
 * To redact sensitive parts of a larger object/string, use redactSensitiveConfig
 * */
declare function redactString(valStr: string | undefined, mode?: RedactMode, hideLength?: boolean): string | undefined;
declare function resetRedactionMap(graph: {
    config: Record<string, {
        isSensitive: boolean;
        value: string;
    }>;
}): void;
/**
 * Redacts senstive config values from any string/array/object/etc
 *
 * NOTE - must be used only after varlock has loaded config
 * */
declare function redactSensitiveConfig(o: any): any;
/**
 * utility to unmask a secret/sensitive value when logging to the console
 * currently this only works on a single secret, not objects or aggregated strings
 * */
declare function revealSensitiveConfig(secretStr: string): string;
declare function scanForLeaks(toScan: string | Response | ReadableStream, meta?: {
    method?: string;
    file?: string;
}): string | Response | ReadableStream<any>;
declare function initVarlockEnv(): void;
declare const ENV: Record<string, any>;

export { ENV, type RedactMode, initVarlockEnv, redactSensitiveConfig, redactString, resetRedactionMap, revealSensitiveConfig, scanForLeaks };
