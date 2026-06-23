const esbuild = require('esbuild');
const path = require('path');

const isWatch = process.argv.includes('--watch');

async function run() {
  const ctx = await esbuild.context({
    entryPoints: [
      path.join(__dirname, 'electron/main.ts'),
      path.join(__dirname, 'electron/preload.ts'),
      path.join(__dirname, 'electron/generator.ts')
    ],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outdir: 'dist-electron',
    external: ['electron'],
    format: 'cjs',
    logLevel: 'info',
    tsconfig: 'electron/tsconfig.json'
  });

  if (isWatch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    ctx.dispose();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
