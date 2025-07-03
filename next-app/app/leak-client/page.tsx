//! This doesnt seem to be working the same way as in previous versions of next

'use client';

import { ENV } from '@varlock/nextjs-integration/runtime';


export default function LeakPage() {
  return (
    <main>
      <h2>Testing CLIENT leak detection</h2>
      <p>This page should fail to build - the page content includes a sensitive config item</p>
      {/* <pre>{ ENV.SECRET_FOO }</pre> */}
    </main>
  );
}
