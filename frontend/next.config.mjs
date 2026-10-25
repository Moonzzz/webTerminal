import { execFileSync } from 'node:child_process';
import { hostname, networkInterfaces, platform } from 'node:os';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  poweredByHeader: false,
};

export default function config(phase) {
  if (phase !== PHASE_DEVELOPMENT_SERVER || nextConfig.allowedDevOrigins !== undefined) {
    return nextConfig;
  }

  const localHostname = platform() === 'darwin'
    ? `${execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName'], {
        encoding: 'utf8',
        timeout: 3000,
      }).trim()}.local`
    : hostname();
  const localAddresses = Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === 'IPv4' && !address.internal)
    .map((address) => address.address);

  return {
    ...nextConfig,
    allowedDevOrigins: [...new Set([localHostname, ...localAddresses])],
  };
}
