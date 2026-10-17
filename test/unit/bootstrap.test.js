/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 */

// Regression guard: on a fresh clone pkg/lib/ (the Cockpit build helpers and
// SCSS) does not exist yet -- only `make` fetches it. `npm ci && npm run build
// && npm test` must still work, so the npm lifecycle has to fetch it first.

import fs from 'node:fs';
import { describe, expect, test } from 'vitest';

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));
const makefile = fs.readFileSync(new URL('Makefile', root), 'utf8');

describe('fresh checkout bootstrap', () => {
    test.each(['prebuild', 'pretest', 'pretest:coverage'])('%s fetches pkg/lib via make', hook => {
        expect(pkg.scripts[hook]).toMatch(/\bmake\b.*\bpkg\/lib\b/);
    });

    test('Makefile has a rule that produces pkg/lib', () => {
        expect(makefile).toMatch(/^COCKPIT_REPO_FILES = \\\n\tpkg\/lib \\$/m);
        expect(makefile).toMatch(/^\$\(COCKPIT_REPO_FILES\): \$\(COCKPIT_REPO_STAMP\)$/m);
    });

    test('Makefile uses LF line endings so the rules above parse everywhere', () => {
        expect(makefile).not.toMatch(/\r/);
    });
});
