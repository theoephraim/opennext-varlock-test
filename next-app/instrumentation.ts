import { ENV } from '@varlock/nextjs-integration/runtime';

export async function register() {
  console.log('instrumentation hook!', process.env.NEXT_RUNTIME, !!process.env.__VARLOCK_ENV, ENV.SECRET_FOO);
  // if (process.env.NEXT_RUNTIME === 'nodejs') {
  //   const { load } = await import('varlock');
  //   load();
  // }
    // const { VarlockRedactor } = await import('varlock');
  //   // VarlockRedactor.patchConsole();
  //   console.log('instrumentaion fired in nodejs runtime', !!process.env.__VARLOCK_ENV);
  // } else {}
  
}