import { ENV } from '@varlock/nextjs-integration/runtime';

export default function Home() {
  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
        <h2>THIS PAGE LEAKS A SENSITIVE VAR</h2>
        <ul>
          {/* <li>SECRET_FOO = { process.env.SECRET_FOO }</li> */}
        </ul>

        {/* <p>hardcoded - secret-foo</p> */}
        {/* <p>process.env - { process.env.SECRET_FOO }</p> */}
        {/* <p>ENV - { ENV.SECRET_FOO }</p> */}
      </main>
    </div>
  );
}
