import { NextConfig } from 'next';

type VarlockPluginOptions = {};
type NextConfigFunction = (phase: string, defaults: {
    defaultConfig: NextConfig;
}) => NextConfig | PromiseLike<NextConfig>;
declare function varlockNextConfigPlugin(pluginOptions?: VarlockPluginOptions): (nextConfig: any | NextConfig | NextConfigFunction) => NextConfigFunction;

export { type NextConfigFunction, varlockNextConfigPlugin };
