const UNMASK_STR = '👁';

export type RedactMode = 'show_first_2' | 'show_last_2' | 'show_first_last';

/**
 * utility to mask/redact a string, for example transforming "hello" into "he▒▒▒"
 * this function just redacts _any_ string passed in
 *
 * To redact sensitive parts of a larger object/string, use redactSensitiveConfig
 * */
export function redactString(valStr: string | undefined, mode?: RedactMode, hideLength = true) {
  if (!valStr) return valStr;

  const hiddenLength = hideLength ? 5 : valStr.length - 2;
  const hiddenStr = '▒'.repeat(hiddenLength);

  if (mode === 'show_last_2') {
    return `${hiddenStr}${valStr.substring(valStr.length - 2, valStr.length)}`;
  } else if (mode === 'show_first_last') {
    return `${valStr.substring(0, 1)}${hiddenStr}${valStr.substring(valStr.length - 1, valStr.length)}`;
  } else { // 'show_first_2' - also default
    return `${valStr.substring(0, 2)}${hiddenStr}`;
  }
}



/** key value lookup of sensitive values to their redacted version */
let sensitiveSecretsMap: Record<string, { key: string, redacted: string }> = {};

type ReplaceFn = (match: string, pre: string, val: string, post: string) => string;
let redactorFindReplace: undefined | { find: RegExp, replace: ReplaceFn };

export function resetRedactionMap(graph: { config: Record<string, { isSensitive: boolean, value: string }> }) {
  // reset map of { [sensitive] => redacted }
  sensitiveSecretsMap = {};
  for (const itemKey in graph.config) {
    const item = graph.config[itemKey];
    if (item.isSensitive && item.value && isString(item.value)) {
      // TODO: we want to respect masking settings from the schema (once added)
      const redacted = redactString(item.value);
      if (redacted) sensitiveSecretsMap[item.value] = { key: itemKey, redacted };
    }
  }

  // reset find/replace regex+fn used for redacting secrets in strings
  const findRegex = new RegExp(
    [
      `(${UNMASK_STR} )?`,
      '(',
      Object.keys(sensitiveSecretsMap)
        // Escape special characters
        .map((s) => s.replace(/[()[\]{}*+?^$|#.,/\\\s-]/g, '\\$&'))
        // Sort for maximal munch
        .sort((a, b) => b.length - a.length)
        .join('|'),
      ')',
      `( ${UNMASK_STR})?`,
    ].join(''),
    'g',
  );

  const replaceFn: ReplaceFn = (match, pre, val, post) => {
    // the pre and post matches only will be populated if they were present
    // and they are used to unmask the secret - so we do not want to replace in this case
    if (pre && post) return match;
    return sensitiveSecretsMap[val].redacted;
  };
  redactorFindReplace = { find: findRegex, replace: replaceFn };
}


// While the module itself acts as a singleton to hold the current map of redacted values
// we expose only the below const to end users


/**
 * Redacts senstive config values from any string/array/object/etc
 *
 * NOTE - must be used only after varlock has loaded config
 * */
export function redactSensitiveConfig(o: any): any {
  if (!redactorFindReplace) return o;
  if (!o) return o;

  // TODO: handle more cases?
  // we can probably redact safely from a few other datatypes - like set,map,etc?
  // objects are a bit tougher
  if (Array.isArray(o)) {
    return o.map(redactSensitiveConfig);
  }
  // try to redact if it's a plain object - not necessarily great for perf...
  if (o && typeof (o) === 'object' && Object.getPrototypeOf(o) === Object.prototype) {
    try {
      return JSON.parse(redactSensitiveConfig(JSON.stringify(o)));
    } catch (err) {
      return o;
    }
  }

  const type = typeof o;
  if (type === 'string' || (type === 'object' && Object.prototype.toString.call(o) === '[object String]')) {
    return (o as string).replaceAll(redactorFindReplace.find, redactorFindReplace.replace);
  }

  return o;
}

/**
 * utility to unmask a secret/sensitive value when logging to the console
 * currently this only works on a single secret, not objects or aggregated strings
 * */
export function revealSensitiveConfig(secretStr: string) {
  // if redaction not enabled, we just return the secret itself
  if (!(globalThis as any)._varlockOrigWriteToConsoleFn) return secretStr;
  // otherwise we add some wrapper characters which will be removed by the patched console behaviour
  return `${UNMASK_STR} ${secretStr} ${UNMASK_STR}`;
}



// this does not cover all cases, but serves our needs so far for Next.js
function isString(s: any) {
  return Object.prototype.toString.call(s) === '[object String]';
}

// reusable leak scanning helper function, used by various integrations
export function scanForLeaks(
  toScan: string | Response | ReadableStream,
  // optional additional information about what is being scanned to be used in error messages
  meta?: {
    method?: string,
    file?: string,
  },
) {
  function scanStrForLeaks(strToScan: string) {
    // console.log('[varlock leak scanner] ', strToScan.substr(0, 100));

    // TODO: probably should use a single regex
    for (const sensitiveValue in sensitiveSecretsMap) {
      if (strToScan.includes(sensitiveValue)) {
        const itemKey = sensitiveSecretsMap[sensitiveValue].key;

        // error stack can gets awkwardly buried since we're so deep in the internals
        // so we'll write a nicer error message to help the user debug
        console.error([
          '',
          `🚨 ${'DETECTED LEAKED SENSITIVE CONFIG'} 🚨`,
          `> Config item key: ${itemKey}`,
          ...meta?.method ? [`> Scan method: ${meta.method}`] : [],
          ...meta?.file ? [`> File: ${meta.file}`] : [],
          '',
        ].join('\n'));

        throw new Error(`🚨 DETECTED LEAKED SENSITIVE CONFIG - ${itemKey}`);
      }
    }
  }

  // scan a string
  if (isString(toScan)) {
    scanStrForLeaks(toScan as string);
    return toScan;
  } else if (toScan instanceof Buffer) {
    scanStrForLeaks(toScan.toString());
    return toScan;
  // scan a ReadableStream by piping it through a scanner
  } else if (toScan instanceof ReadableStream) {
    if (toScan.locked) {
      // console.log('> stream already locked');
      return toScan;
    } else {
      // console.log('> stream will be scanned!');
    }
    const chunkDecoder = new TextDecoder();
    return toScan.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          const chunkStr = chunkDecoder.decode(chunk);
          scanStrForLeaks(chunkStr);
          controller.enqueue(chunk);
        },
      }),
    );
  }
  // other things may be passed in like Buffer... but we'll ignore for now
  return toScan;
}

// -----------




// --------------

let initializedEnv = false;
const envValues = {} as Record<string, any>;
console.log('LOADED ENV RUNTIME - initialized?', initializedEnv);


export function initVarlockEnv() {
  console.log('⚡️ INIT VARLOCK ENV!');
  try {
    const serializedEnvData: Record<string, { value: string, isSensitive: boolean }> = JSON.parse(process.env.__VARLOCK_ENV || '{}');
    resetRedactionMap({ config: serializedEnvData });
    for (const [key, value] of Object.entries(serializedEnvData)) {
      envValues[key] = (value as any).value;
    }
  } catch (err) {
    console.error('failed to load varlock env', err, process.env.__VARLOCK_ENV);
  }
  initializedEnv = true;
}

if (process.env.__VARLOCK_ENV && !initializedEnv) initVarlockEnv();

const EnvProxy = new Proxy({} as Record<string, any>, {
  get(target, prop) {
    if (typeof prop !== 'string') throw new Error('prop keys cannot be symbols');
    return envValues[prop];
  },
});

export const ENV = EnvProxy;
