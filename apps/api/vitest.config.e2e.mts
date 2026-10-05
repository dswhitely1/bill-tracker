import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    root: import.meta.dirname,
    include: ['test/**/*.int-spec.ts', 'test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // Multiple spec files share one Postgres test database and truncate its
    // tables in their own beforeEach hooks. Running files in parallel lets
    // one file's truncate/insert race another's assertions. `poolOptions`
    // was removed in Vitest 4 (options are now top-level); this is its
    // replacement for serializing file execution.
    fileParallelism: false,
  },
});
