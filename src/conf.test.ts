import { describe, expect, test } from 'vitest';
import type { EnvVarDefinition } from '@snstac/cockpit-shared';
// The package barrel also re-exports PatternFly-based cards whose CSS imports
// Node cannot load in the plain `node` environment, so pull the real
// EnvironmentFile helpers straight from their module (same code app.tsx uses).
import {
    defaultFormFromConf,
    parseEnvDefault,
    serializeEnvDefault,
    shellQuoteValue,
} from '../node_modules/@snstac/cockpit-shared/src/envDefaultFile';

import { CONF_PARAMS } from './conf';

const entries = Object.entries(CONF_PARAMS);

function def(key: string): EnvVarDefinition {
    const d = CONF_PARAMS[key];
    if (!d)
        throw new Error(`CONF_PARAMS has no ${key}`);
    return d;
}

function validation(key: string): RegExp {
    const re = def(key).validation;
    if (!re)
        throw new Error(`${key} has no validation regex`);
    return re;
}

// A value is acceptable when it passes the regex and, for numbers, sits in range.
function accepts(key: string, value: string): boolean {
    const d = def(key);
    if (d.validation && !d.validation.test(value))
        return false;
    if (d.range && value !== '') {
        const n = Number(value);
        if (n < d.range[0] || n > d.range[1])
            return false;
    }
    return true;
}

describe('CONF_PARAMS schema', () => {
    test('defines the expected keys', () => {
        expect(Object.keys(CONF_PARAMS).sort()).toEqual([
            'COT_STALE',
            'COT_TYPE',
            'COT_URL',
            'DEBUG',
            'PYTAK_TLS_CLIENT_CAFILE',
            'PYTAK_TLS_CLIENT_CERT',
            'PYTAK_TLS_CLIENT_KEY',
            'SAPIENT_HOST',
            'SAPIENT_LEN_BYTES',
            'SAPIENT_LEN_ENDIAN',
            'SAPIENT_PORT',
            'SAPIENT_VERSION',
            'TAK_PROTO',
        ]);
    });

    test('keys are valid EnvironmentFile variable names', () => {
        for (const key of Object.keys(CONF_PARAMS))
            expect(key).toMatch(/^[A-Z][A-Z0-9_]*$/);
    });

    test('COT_URL and SAPIENT_HOST are the required keys', () => {
        const required = entries.filter(([, d]) => d.required === true).map(([k]) => k)
                .sort();
        expect(required).toEqual(['COT_URL', 'SAPIENT_HOST']);
        expect(def('COT_URL').defaultValue).not.toBe('');
        expect(def('SAPIENT_HOST').defaultValue).not.toBe('');
    });

    test.each(entries)('%s has a description, a string default and a validation regex', (_key, d) => {
        expect(typeof d.description).toBe('string');
        expect(d.description.trim().length).toBeGreaterThan(0);
        expect(typeof d.defaultValue).toBe('string');
        expect(d.validation).toBeInstanceOf(RegExp);
    });

    test.each(entries)('%s default passes its own validation', (key, d) => {
        if (d.defaultValue === '')
            expect(d.required).not.toBe(true);
        expect(d.validation?.test(d.defaultValue)).toBe(true);
        expect(accepts(key, d.defaultValue)).toBe(true);
    });

    const numbers = entries.filter(([, d]) => d.type === 'number');
    test('number entries exist', () => {
        expect(numbers.map(([k]) => k).sort()).toEqual(['COT_STALE', 'SAPIENT_LEN_BYTES', 'SAPIENT_PORT']);
    });

    test.each(numbers)('%s number default is an integer inside range', (_key, d) => {
        expect(d.range).toBeDefined();
        const [lo, hi] = d.range ?? [NaN, NaN];
        expect(lo).toBeLessThanOrEqual(hi);
        const n = Number(d.defaultValue);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(lo);
        expect(n).toBeLessThanOrEqual(hi);
    });

    test.each(numbers)('%s range bounds pass validation', (_key, d) => {
        const [lo, hi] = d.range ?? [NaN, NaN];
        expect(d.validation?.test(String(lo))).toBe(true);
        expect(d.validation?.test(String(hi))).toBe(true);
    });

    const enums = entries.filter(([, d]) => d.type === 'enum');
    test('enum entries exist', () => {
        expect(enums.map(([k]) => k).sort()).toEqual(['SAPIENT_LEN_ENDIAN', 'SAPIENT_VERSION', 'TAK_PROTO']);
    });

    test.each(enums)('%s enum default is one of its options and every option validates', (_key, d) => {
        expect(d.options).toBeDefined();
        const options = d.options ?? [];
        expect(options.length).toBeGreaterThan(0);
        expect(new Set(options).size).toBe(options.length);
        expect(options).toContain(d.defaultValue);
        for (const opt of options)
            expect(d.validation?.test(opt)).toBe(true);
    });

    test('only enum entries carry options and only number entries carry a range', () => {
        for (const [, d] of entries) {
            if (d.type !== 'enum')
                expect(d.options).toBeUndefined();
            if (d.type !== 'number')
                expect(d.range).toBeUndefined();
        }
    });

    test('regexes are not global/sticky (RegExp.test must be stateless)', () => {
        for (const [, d] of entries) {
            expect(d.validation?.global).toBe(false);
            expect(d.validation?.sticky).toBe(false);
        }
    });
});

type Cases = { accept: string[]; reject: string[] };

const VALIDATION_CASES: Record<string, Cases> = {
    COT_URL: {
        accept: [
            'udp+wo://239.2.3.1:6969',
            'tls://takserver:8089',
            'tcp+wo://h:1',
            'tcp://10.0.0.1:8087',
            'udp://239.2.3.1:6969',
            'udp+broadcast://255.255.255.255:6969',
            'http://example.com/cot',
            'https://example.com:8443/cot',
            'file:///tmp/cot.xml',
            'log://stdout',
        ],
        reject: [
            '',
            'ftp://x',
            'udp://',
            'udp://a b',
            'udp:/239.2.3.1:6969',
            '239.2.3.1:6969',
            'UDP://239.2.3.1:6969',
            ' udp://h:1',
            'udp://h:1 ',
            'udp://h:1\nEVIL=1',
            'tls+wo://h:1',
        ],
    },
    SAPIENT_HOST: {
        accept: ['127.0.0.1', '10.0.0.5', 'sapient-node.local', 'fusion_1', 'localhost'],
        reject: ['', 'a b', 'host;rm', 'host$(id)', 'h`id`', 'h:5010', 'h/x', 'h\nX=1', '"h"'],
    },
    SAPIENT_PORT: {
        accept: ['1', '5010', '65535'],
        reject: ['', '0', '65536', '99999', '123456', '-1', '50.1', 'abc', ' 5010'],
    },
    SAPIENT_VERSION: {
        accept: ['v1', 'v2'],
        reject: ['', 'v3', 'V2', '2', 'v2 ', 'v12'],
    },
    COT_TYPE: {
        accept: ['', 'a-f-A', 'a-u-G-U-C', 'a-h-S', 'a-n-G-E-V-C', 'a-f-G-1'],
        reject: ['b-f', 'a-', 'a-f-', 'a--G', 'a-F-G', 'a-f-G ', 'a-f-G;rm', 'b-m-p-s-p-i', 'a-f G'],
    },
    COT_STALE: {
        accept: ['1', '60', '3600', '86400'],
        reject: ['', '0', '86401', '-5', '1.5', 'sixty'],
    },
    SAPIENT_LEN_BYTES: {
        accept: ['1', '2', '3', '4', '5', '6', '7', '8'],
        reject: ['', '0', '9', '10', '04', '-1', 'four'],
    },
    SAPIENT_LEN_ENDIAN: {
        accept: ['little', 'big'],
        reject: ['', 'Little', 'BIG', 'middle', 'littlebig', 'little '],
    },
    TAK_PROTO: {
        accept: ['0', '1', '2'],
        reject: ['', '3', '00', '-1', 'xml'],
    },
    PYTAK_TLS_CLIENT_CERT: {
        accept: ['', '/etc/x.pem', '/etc/sapientcot/client.cert.pem', '/'],
        reject: ['relative/x', 'x.pem', '/a b', ' /etc/x.pem', '/etc/x.pem\nEVIL=1', '~/x.pem'],
    },
    PYTAK_TLS_CLIENT_KEY: {
        accept: ['', '/etc/x.key', '/etc/sapientcot/client.key.pem'],
        reject: ['relative/x', 'x.key', '/a b', '/a\tb'],
    },
    PYTAK_TLS_CLIENT_CAFILE: {
        accept: ['', '/etc/sapientcot/tls/ca.pem', '/etc/ssl/certs/ca-certificates.crt'],
        reject: ['relative/ca.pem', 'ca.pem', '/a b', '/etc/ca.pem\nEVIL=1'],
    },
    DEBUG: {
        accept: ['', 'true', 'false', '0', '1', 'TRUE', 'False'],
        reject: ['yes', 'no', 'on', '2', 'true ', 'truefalse'],
    },
};

describe('validation regexes', () => {
    test('every CONF_PARAMS key has accept/reject cases', () => {
        expect(Object.keys(VALIDATION_CASES).sort()).toEqual(Object.keys(CONF_PARAMS).sort());
    });

    for (const [key, cases] of Object.entries(VALIDATION_CASES)) {
        describe(key, () => {
            test.each(cases.accept)(`accepts %j`, (value) => {
                expect(accepts(key, value)).toBe(true);
            });
            test.each(cases.reject)(`rejects %j`, (value) => {
                expect(accepts(key, value)).toBe(false);
            });
        });
    }

    test('number regexes on their own allow out-of-range digits (range does the bounding)', () => {
        expect(validation('SAPIENT_PORT').test('99999')).toBe(true);
        expect(validation('COT_STALE').test('0')).toBe(true);
    });
});

describe('/etc/default/sapientcot round-trip', () => {
    const knownKeys = new Set(Object.keys(CONF_PARAMS));

    test('defaultFormFromConf yields every default', () => {
        const form = defaultFormFromConf(CONF_PARAMS);
        expect(Object.keys(form).sort()).toEqual(Object.keys(CONF_PARAMS).sort());
        for (const [key, d] of entries)
            expect(form[key]).toBe(d.defaultValue);
    });

    test('defaults serialize into a fresh file that parses back to the same values', () => {
        const form = defaultFormFromConf(CONF_PARAMS);
        const text = serializeEnvDefault([], form, CONF_PARAMS);

        // A fresh file only gets the required keys; optional ones equal to their default are omitted.
        expect(text).toBe([
            '# Added by Cockpit',
            'COT_URL=udp+wo://239.2.3.1:6969',
            'SAPIENT_HOST=127.0.0.1',
        ].join('\n'));

        const parsed = parseEnvDefault(text, knownKeys);
        expect(parsed.values).toEqual({ COT_URL: form.COT_URL, SAPIENT_HOST: form.SAPIENT_HOST });
        // Missing optional keys fall back to their defaults => the effective config is unchanged.
        expect({ ...form, ...parsed.values }).toEqual(form);
    });

    test('a file listing every key round-trips all defaults, including empty ones', () => {
        const form = defaultFormFromConf(CONF_PARAMS);
        const template = Object.keys(CONF_PARAMS).map(k => `${k}=`)
                .join('\n');
        const { lines } = parseEnvDefault(template, knownKeys);
        const text = serializeEnvDefault(lines, form, CONF_PARAMS);

        expect(text).not.toContain('# Added by Cockpit');
        expect(text).toContain('COT_TYPE=""');
        expect(text).toContain('PYTAK_TLS_CLIENT_CERT=""');
        expect(text).toContain('SAPIENT_PORT=5010');

        const parsed = parseEnvDefault(text, knownKeys);
        expect(parsed.values).toEqual(form);
        expect(serializeEnvDefault(parsed.lines, parsed.values, CONF_PARAMS)).toBe(text);
    });

    test('non-default values round-trip and preserve comments and unknown variables', () => {
        const original = [
            '# sapientcot settings',
            'export COT_URL=tls://takserver:8089',
            'OTHER_VAR=keep me',
            '',
        ].join('\n');
        const { lines, values } = parseEnvDefault(original, knownKeys);
        const form = {
            ...defaultFormFromConf(CONF_PARAMS),
            ...values,
            SAPIENT_HOST: 'sapient-node.local',
            SAPIENT_PORT: '6010',
            COT_TYPE: 'a-u-G-U-C',
            PYTAK_TLS_CLIENT_CERT: '/etc/sapientcot/client.pem',
            DEBUG: 'true',
        };
        for (const [key, value] of Object.entries(form))
            expect(accepts(key, value)).toBe(true);

        const text = serializeEnvDefault(lines, form, CONF_PARAMS);
        expect(text.startsWith('# sapientcot settings\nexport COT_URL=tls://takserver:8089\nOTHER_VAR=keep me\n')).toBe(true);

        const parsed = parseEnvDefault(text, knownKeys);
        expect({ ...defaultFormFromConf(CONF_PARAMS), ...parsed.values }).toEqual(form);
    });

    // /etc/default files are sometimes sourced by a shell; anything a regex lets
    // through that contains shell metacharacters must come out quoted/escaped.
    const SHELL_META: [string, string][] = [
        ['COT_URL', 'udp://h:1;reboot'],
        ['COT_URL', 'tcp://h:1/$(id)'],
        ['COT_URL', 'http://h/`id`'],
        ['COT_URL', 'http://h/a&b|c'],
        ['PYTAK_TLS_CLIENT_CERT', '/etc/x.pem;rm'],
        ['PYTAK_TLS_CLIENT_KEY', '/etc/$HOME/k'],
        ['PYTAK_TLS_CLIENT_CAFILE', '/etc/`id`/ca.pem'],
    ];
    const ACCEPTED_META = SHELL_META.filter(([, v]) => !/[$`]/.test(v));

    test.each(ACCEPTED_META)('%s value %j passes validation but serializes shell-safely', (key, value) => {
        expect(accepts(key, value)).toBe(true);
        const quoted = shellQuoteValue(value, def(key));
        expect(quoted.startsWith('"') && quoted.endsWith('"')).toBe(true);
        // Every $ and ` inside the double quotes is backslash-escaped.
        expect(quoted.slice(1, -1)).not.toMatch(/(^|[^\\])[$`]/);
    });

    test.each(ACCEPTED_META)('%s value %j round-trips through the file', (key, value) => {
        const text = serializeEnvDefault([], { ...defaultFormFromConf(CONF_PARAMS), [key]: value }, CONF_PARAMS);
        expect(parseEnvDefault(text, knownKeys).values[key]).toBe(value);
    });

    // @snstac/cockpit-shared's shellQuoteValue escapes `$` and backtick as
    // `\$` / `\``, but parseEnvDefault only un-escapes `\"` and `\\`, so such
    // values gain a backslash on every save. Until the reader is fixed
    // upstream, validation must keep them out of the file.
    test.each(SHELL_META.filter(([, v]) => /[$`]/.test(v)))('%s value %j is rejected by validation', (key, value) => {
        expect(accepts(key, value)).toBe(false);
    });
});
