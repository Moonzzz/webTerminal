import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeFileTrace } from '@vercel/nft';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(projectRoot, 'dist/production');
const serverEntry = 'dist/backend/server.js';
const dynamicRuntimeFiles = [
  'node_modules/next/dist/compiled/@babel/runtime/package.json',
  'node_modules/next/dist/compiled/webpack',
];

process.chdir(projectRoot);
await rm(outputDir, { recursive: true, force: true });

const { fileList, warnings } = await nodeFileTrace([serverEntry], {
  base: projectRoot,
  processCwd: projectRoot,
  conditions: ['node', 'production'],
  exportsOnly: true,
  ignore: [
    'frontend/**/*',
    'node_modules/**/*.d.ts',
    'node_modules/**/*.map',
    'node_modules/@img/**/*',
    'node_modules/sharp/**/*',
  ],
});

if (warnings.size > 0) {
  console.warn(
    `Production dependency tracing completed with ${warnings.size} dynamic or optional dependency warnings.`,
  );
}

for (const relativeFile of [...fileList].sort()) {
  await copyPath(relativeFile);
}

await Promise.all([
  copyPath('package.json'),
  copyPath('config'),
  copyPath('frontend/next.config.mjs'),
  copyNextBuild(),
  ...dynamicRuntimeFiles.map(copyDynamicRuntimePath),
]);

const bundleStats = await getDirectoryStats(outputDir);
console.log(
  `Production bundle contains ${bundleStats.files} files (${formatBytes(bundleStats.bytes)}).`,
);

async function copyNextBuild() {
  const sourceRoot = path.join(projectRoot, 'frontend/.next');
  const targetRoot = path.join(outputDir, 'frontend/.next');

  await cp(sourceRoot, targetRoot, {
    recursive: true,
    filter(source) {
      const relativePath = path.relative(sourceRoot, source);
      const topLevelEntry = relativePath.split(path.sep)[0];
      return (
        !['cache', 'dev', 'diagnostics', 'trace', 'types'].includes(topLevelEntry) &&
        path.extname(source) !== '.map'
      );
    },
  });
}

async function copyPath(relativePath) {
  const source = path.join(projectRoot, relativePath);
  const target = path.join(outputDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, dereference: false });
}

async function copyDynamicRuntimePath(relativePath) {
  const source = path.join(projectRoot, relativePath);
  const target = path.join(outputDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    dereference: false,
    filter(candidate) {
      return !candidate.endsWith('.d.ts') && path.extname(candidate) !== '.map';
    },
  });
}

async function getDirectoryStats(directory) {
  let files = 0;
  let bytes = 0;

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const childStats = await getDirectoryStats(entryPath);
      files += childStats.files;
      bytes += childStats.bytes;
    } else {
      files += 1;
      bytes += (await stat(entryPath)).size;
    }
  }

  return { files, bytes };
}

function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
