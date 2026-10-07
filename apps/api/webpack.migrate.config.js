const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

/**
 * The migration runner's own bundle, built by the `build-migrate` target.
 *
 * Output goes to `dist-migrate/` rather than alongside `main.js`. Both this
 * config and `webpack.config.js` set `clean: true` on their output path, so
 * sharing `dist/` would mean whichever built second wiped the other — a
 * failure that depends on task order and would not reproduce reliably.
 *
 * Externals match the main bundle's (both reach typeorm through
 * `data-source.ts`), so the pruned manifest `prune-lockfile` derives from
 * `package.json` covers this bundle too — no second install is needed in
 * the image.
 */
module.exports = {
  output: {
    path: join(__dirname, 'dist-migrate'),
    clean: true,
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/database/migrate.ts',
      tsConfig: './tsconfig.app.json',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: false,
    }),
  ],
};
