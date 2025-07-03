import type { NextConfig } from "next";
import { varlockNextConfigPlugin } from '@varlock/nextjs-integration/plugin';

console.log('log from next.config.ts', process.env.TEST1);

const nextConfig: NextConfig = {
  /* config options here */
  // output: 'export',
  // compress: false,
  // output: 'standalone'
};

export default varlockNextConfigPlugin()(nextConfig);

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();