import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const stub = name => fileURLToPath(new URL(`./test/unit/stubs/${name}`, import.meta.url));

export default defineConfig({
    resolve: {
        // Modules that only exist inside a running Cockpit session (served by
        // the bridge) get small stand-ins; tests vi.mock() them as needed.
        alias: {
            cockpit: stub('cockpit.js'),
            'cockpit-dark-theme': stub('empty.js'),
        },
    },
    test: {
        include: ['src/**/*.test.{ts,tsx}', 'test/unit/**/*.test.{js,ts,tsx}'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/*.test.{ts,tsx}'],
            reporter: ['text', 'json-summary', 'lcov'],
            thresholds: {
                lines: 90,
                functions: 90,
                branches: 90,
                statements: 90,
            },
        },
    },
});
