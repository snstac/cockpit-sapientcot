// @vitest-environment jsdom
/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { Application } from './app';

type WatchCb = () => void;
type StreamCb = (data: string) => void;
type VoidCb = () => void;

interface FakeProc extends Promise<string> {
    stream: (cb: StreamCb) => FakeProc;
    done: (cb: VoidCb) => FakeProc;
    fail: (cb: VoidCb) => FakeProc;
    close: () => void;
}

interface FollowHandle {
    proc: FakeProc;
    emit: (data: string) => void;
    finish: () => void;
    error: () => void;
}

const h = vi.hoisted(() => {
    const state = {
        watchCb: null as WatchCb | null,
        follows: [] as FollowHandle[],
    };
    const read = vi.fn<() => Promise<string>>();
    const replace = vi.fn<(content: string) => Promise<string>>();
    const remove = vi.fn();
    const watch = vi.fn((cb: WatchCb) => {
        state.watchCb = cb;
        return { remove };
    });
    const file = vi.fn<(path: string, opts?: unknown) => { read: typeof read; replace: typeof replace; watch: typeof watch }>(
        () => ({ read, replace, watch })
    );
    const status = vi.fn<() => Promise<string>>();
    const restart = vi.fn<() => Promise<string>>();
    const logs = vi.fn<() => Promise<string>>();
    const close = vi.fn();
    return { state, read, replace, remove, watch, file, status, restart, logs, close };
});

function makeFollowProc(): FollowHandle {
    let streamCb: StreamCb | null = null;
    let doneCb: VoidCb | null = null;
    let failCb: VoidCb | null = null;
    const base = new Promise<string>(() => { /* never settles */ });
    const proc = base as FakeProc;
    proc.stream = cb => { streamCb = cb; return proc };
    proc.done = cb => { doneCb = cb; return proc };
    proc.fail = cb => { failCb = cb; return proc };
    proc.close = h.close;
    return {
        proc,
        emit: data => streamCb?.(data),
        finish: () => doneCb?.(),
        error: () => failCb?.(),
    };
}

function fakeSpawn(argv: string[]): Promise<string> {
    if (argv[0] === 'systemctl' && argv[1] === 'status')
        return h.status();
    if (argv[0] === 'systemctl' && argv[1] === 'restart')
        return h.restart();
    if (argv[0] === 'journalctl' && argv.includes('-f')) {
        const f = makeFollowProc();
        h.state.follows.push(f);
        return f.proc;
    }
    if (argv[0] === 'journalctl')
        return h.logs();
    throw new Error('unexpected spawn ' + argv.join(' '));
}

vi.mock('cockpit', () => ({
    default: {
        gettext: (s: string) => s,
        file: h.file,
        spawn: (argv: string[]) => fakeSpawn(argv),
    },
}));

// PatternFly's ESM build imports .css files, which Node cannot load when the
// package is externalized by vitest; lightweight stand-ins keep the behaviour
// app.tsx relies on (expandable cards, alert action, checkbox onChange).
type Kids = { children?: React.ReactNode };

vi.mock('@patternfly/react-core/dist/esm/components/Alert/index.js', () => ({
    Alert: ({ title, actionClose }: { title: React.ReactNode; actionClose?: React.ReactNode }) => (
        <div role="alert"><span>{title}</span>{actionClose}</div>
    ),
}));

vi.mock('@patternfly/react-core/dist/esm/components/Card/index.js', () => {
    const Ctx = React.createContext(false);
    return {
        Card: ({ isExpanded, children }: Kids & { isExpanded?: boolean }) => (
            <Ctx.Provider value={isExpanded === true}><section>{children}</section></Ctx.Provider>
        ),
        CardHeader: ({ onExpand, toggleButtonProps, children }: Kids & {
            onExpand?: () => void;
            toggleButtonProps?: { id?: string; 'aria-label'?: string };
        }) => (
            <div>
                {onExpand && (
                    <button
                        type="button"
                        id={toggleButtonProps?.id}
                        aria-label={toggleButtonProps?.['aria-label']}
                        onClick={onExpand}
                    />
                )}
                {children}
            </div>
        ),
        CardTitle: ({ children }: Kids) => <h2>{children}</h2>,
        CardBody: ({ children }: Kids) => <div>{children}</div>,
        CardExpandableContent: ({ children }: Kids) => {
            const expanded = React.useContext(Ctx);
            return expanded ? <div>{children}</div> : null;
        },
    };
});

vi.mock('@patternfly/react-core/dist/esm/components/DataList/index.js', () => ({
    DataList: ({ children }: Kids) => <ul>{children}</ul>,
    DataListItem: ({ children }: Kids) => <li>{children}</li>,
    DataListItemRow: ({ children }: Kids) => <div>{children}</div>,
    DataListItemCells: ({ dataListCells }: { dataListCells: React.ReactNode }) => <div>{dataListCells}</div>,
    DataListCell: ({ children }: Kids) => <div>{children}</div>,
}));

vi.mock('@patternfly/react-core', () => ({
    capitalize: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
    Checkbox: ({ id, label, isChecked, onChange }: {
        id: string;
        label: React.ReactNode;
        isChecked: boolean;
        onChange: (ev: React.FormEvent<HTMLInputElement>, checked: boolean) => void;
    }) => (
        <span>
            <input
                type="checkbox"
                id={id}
                checked={isChecked}
                onChange={ev => onChange(ev, ev.currentTarget.checked)}
            />
            <label htmlFor={id}>{label}</label>
        </span>
    ),
}));

vi.mock('./conf', async importOriginal => {
    const orig = await importOriginal<typeof import('./conf')>();
    // Synthetic definitions appended to the real schema so that validateField
    // branches unreachable with the shipped schema (no regex in front of the
    // range / options checks, enum without options, number without range)
    // are exercised.
    return {
        CONF_PARAMS: {
            ...orig.CONF_PARAMS,
            ZZ_ENUM: {
                type: 'enum',
                description: 'synthetic enum without regex',
                defaultValue: 'a',
                options: ['a', 'b'],
            },
            ZZ_NUM: {
                type: 'number',
                description: 'synthetic number without regex',
                defaultValue: '5',
                range: [1, 10],
            },
            ZZ_NUM_NORANGE: {
                type: 'number',
                description: 'synthetic number without range',
                defaultValue: '',
            },
            ZZ_ENUM_NOOPTS: {
                type: 'enum',
                description: 'synthetic enum without options',
                defaultValue: '',
            },
        },
    };
});

vi.mock('@snstac/cockpit-shared', async importOriginal => {
    const orig = await importOriginal<typeof import('@snstac/cockpit-shared')>();
    type Toast = { variant: 'success' | 'danger' | 'warning'; title: string };
    type Paths = { cert?: string; key?: string; ca?: string };
    return {
        ...orig,
        ServiceManagementCard: ({ onToast }: { onToast: (t: Toast) => void }) => (
            <button type="button" onClick={() => onToast({ variant: 'success', title: 'svc toast' })}>
                svc-toast
            </button>
        ),
        TlsUploadCard: ({ onToast, onInstalledPaths }: {
            onToast: (t: Toast) => void;
            onInstalledPaths: (p: Paths) => void;
        }) => (
            <div>
                <button type="button" onClick={() => onToast({ variant: 'warning', title: 'tls toast' })}>
                    tls-toast
                </button>
                <button type="button" onClick={() => onInstalledPaths({ cert: '/etc/sapientcot/tls/cert.pem' })}>
                    tls-cert
                </button>
                <button type="button" onClick={() => onInstalledPaths({ key: '/etc/sapientcot/tls/key.pem' })}>
                    tls-key
                </button>
                <button type="button" onClick={() => onInstalledPaths({ ca: '/etc/sapientcot/tls/ca.pem' })}>
                    tls-ca
                </button>
                <button type="button" onClick={() => onInstalledPaths({})}>
                    tls-none
                </button>
            </div>
        ),
    };
});

const SAMPLE = [
    '# sapientcot config',
    'COT_URL=tcp://10.0.0.1:8087',
    'SAPIENT_HOST=sensor.local',
    'SAPIENT_PORT=5011',
    'DEBUG=true',
    'OTHER_VAR=keepme',
    '',
].join('\n');

function input(key: string): HTMLInputElement | HTMLSelectElement {
    const el = document.getElementById(`envvar-input-${key}`);
    if (!el)
        throw new Error(`no input for ${key}`);
    return el as HTMLInputElement | HTMLSelectElement;
}

function rawPre(): HTMLElement {
    const label = screen.getByText(/Raw Configuration File Contents/);
    const pre = label.parentElement?.querySelector('pre');
    if (!pre)
        throw new Error('no raw pre');
    return pre;
}

function logsPre(): HTMLElement {
    const btn = screen.getByRole('button', { name: 'Show Logs' });
    const pre = btn.parentElement?.nextElementSibling;
    if (!(pre instanceof HTMLElement))
        throw new Error('no logs pre');
    return pre;
}

async function renderLoaded(content = SAMPLE) {
    h.read.mockResolvedValue(content);
    const utils = render(<Application />);
    await waitFor(() => expect((input('COT_URL') as HTMLInputElement).value)
            .toBe(content.includes('COT_URL=tcp') ? 'tcp://10.0.0.1:8087' : 'udp+wo://239.2.3.1:6969'));
    return utils;
}

function submit() {
    fireEvent.click(screen.getByRole('button', { name: 'Validate & Save' }));
}

function expandDebug() {
    fireEvent.click(screen.getByRole('button', { name: 'Expand debug' }));
}

beforeEach(() => {
    h.state.watchCb = null;
    h.state.follows = [];
    h.status.mockResolvedValue('active (running)');
    h.replace.mockResolvedValue('tag');
    h.restart.mockResolvedValue('');
    h.logs.mockResolvedValue('log line');
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    h.read.mockReset();
    h.replace.mockReset();
    h.status.mockReset();
    h.restart.mockReset();
    h.logs.mockReset();
});

describe('loading configuration', () => {
    test('populates the form and raw contents from the file', async () => {
        await renderLoaded();
        expect(h.file).toHaveBeenCalledWith('/etc/default/sapientcot', { superuser: 'try' });
        expect((input('SAPIENT_HOST') as HTMLInputElement).value).toBe('sensor.local');
        expect((input('SAPIENT_PORT') as HTMLInputElement).value).toBe('5011');
        // Unset keys fall back to defaults.
        expect((input('COT_STALE') as HTMLInputElement).value).toBe('60');
        expect((input('SAPIENT_VERSION') as HTMLSelectElement).value).toBe('v2');
        expect(screen.queryByText(/unsaved changes/)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Expand advanced' }));
        expect(rawPre().textContent).toBe(SAMPLE);
    });

    test('shows a warning when reading fails with an Error', async () => {
        h.read.mockRejectedValue(new Error('permission denied'));
        render(<Application />);
        expect(await screen.findByText('Failed to read configuration file: permission denied.')).toBeTruthy();
        expect((input('COT_URL') as HTMLInputElement).value).toBe('udp+wo://239.2.3.1:6969');
        fireEvent.click(screen.getByRole('button', { name: 'Expand advanced' }));
        expect(rawPre().textContent).toBe('');
    });

    test('shows a warning when reading fails with a non-Error', async () => {
        h.read.mockRejectedValue('no such file');
        render(<Application />);
        expect(await screen.findByText('Failed to read configuration file: no such file.')).toBeTruthy();
    });

    test('a successful reload clears a previous load error', async () => {
        h.read.mockRejectedValueOnce(new Error('boom'));
        render(<Application />);
        await screen.findByText('Failed to read configuration file: boom.');
        h.read.mockResolvedValue(SAMPLE);
        await act(async () => { h.state.watchCb?.() });
        await waitFor(() => expect(screen.queryByText(/Failed to read configuration file/)).toBeNull());
        expect((input('SAPIENT_HOST') as HTMLInputElement).value).toBe('sensor.local');
    });

    test('watcher callback reloads the file', async () => {
        await renderLoaded();
        expect(h.watch).toHaveBeenCalledTimes(1);
        h.read.mockResolvedValue(SAMPLE.replace('sensor.local', 'other.host'));
        await act(async () => { h.state.watchCb?.() });
        await waitFor(() => expect((input('SAPIENT_HOST') as HTMLInputElement).value).toBe('other.host'));
    });

    test('watcher is removed on unmount', async () => {
        const { unmount } = await renderLoaded();
        unmount();
        expect(h.remove).toHaveBeenCalledTimes(1);
    });

    test('tolerates a watcher without remove()', async () => {
        h.watch.mockReturnValueOnce(undefined as unknown as { remove: typeof h.remove });
        const { unmount } = await renderLoaded();
        expect(() => unmount()).not.toThrow();
        expect(h.remove).not.toHaveBeenCalled();
    });

    test('reloads are ignored while there are unsaved edits', async () => {
        await renderLoaded();
        fireEvent.change(input('SAPIENT_HOST'), { target: { value: 'edited.host' } });
        expect(screen.getByText(/unsaved changes/)).toBeTruthy();

        h.read.mockResolvedValue(SAMPLE.replace('sensor.local', 'disk.host'));
        await act(async () => { h.state.watchCb?.() });
        expect((input('SAPIENT_HOST') as HTMLInputElement).value).toBe('edited.host');

        h.read.mockRejectedValue(new Error('gone'));
        await act(async () => { h.state.watchCb?.() });
        expect(screen.queryByText(/Failed to read configuration file/)).toBeNull();
        expect((input('SAPIENT_HOST') as HTMLInputElement).value).toBe('edited.host');
    });
});

describe('field validation', () => {
    async function change(key: string, value: string) {
        fireEvent.change(input(key), { target: { value } });
    }

    test('required field left empty is invalid', async () => {
        await renderLoaded();
        await change('COT_URL', '');
        expect(screen.getByText('Invalid value')).toBeTruthy();
    });

    test('regex failure is invalid, and fixing it clears the error', async () => {
        await renderLoaded();
        await change('SAPIENT_HOST', 'bad host!');
        expect(screen.getByText('Invalid value')).toBeTruthy();
        await change('SAPIENT_HOST', 'good.host');
        expect(screen.queryByText('Invalid value')).toBeNull();
    });

    test('optional empty value is valid', async () => {
        await renderLoaded();
        await change('COT_TYPE', '');
        expect(screen.queryByText('Invalid value')).toBeNull();
    });

    test('number out of range (above and below)', async () => {
        await renderLoaded();
        await change('SAPIENT_PORT', '70000');
        expect(screen.getByText('Value must be between 1 and 65535')).toBeTruthy();
        await change('SAPIENT_PORT', '0');
        expect(screen.getByText('Value must be between 1 and 65535')).toBeTruthy();
        await change('SAPIENT_PORT', '8080');
        expect(screen.queryByText(/Value must be between/)).toBeNull();
    });

    test('NaN number and invalid enum option loaded from disk fail on submit', async () => {
        await renderLoaded(SAMPLE + 'ZZ_NUM=abc\nZZ_ENUM=zzz\n');
        submit();
        expect(await screen.findByText('Value must be between 1 and 10')).toBeTruthy();
        expect(screen.getByText('Invalid option')).toBeTruthy();
        expect(screen.getByText('Fix validation errors before saving.')).toBeTruthy();
        expect(h.replace).not.toHaveBeenCalled();
    });

    test('enum select change to a valid option', async () => {
        await renderLoaded();
        await change('SAPIENT_VERSION', 'v1');
        expect((input('SAPIENT_VERSION') as HTMLSelectElement).value).toBe('v1');
        await change('ZZ_ENUM', 'b');
        expect((input('ZZ_ENUM') as HTMLSelectElement).value).toBe('b');
        expect(screen.queryByText('Invalid option')).toBeNull();
    });

    test('boolean select change', async () => {
        await renderLoaded();
        expect((input('DEBUG') as HTMLSelectElement).value).toBe('true');
        await change('DEBUG', 'false');
        expect((input('DEBUG') as HTMLSelectElement).value).toBe('false');
        expect(screen.getByText(/unsaved changes/)).toBeTruthy();
    });

    // BUG: DEBUG's schema accepts 0/1 and any case (/^(true|false|0|1)?$/i),
    // but the boolean <select> only has "true"/"false" options. A file value
    // such as DEBUG=0 matches no option, so the browser falls back to the
    // first option and the UI shows "True" although debug logging is OFF.
    test.fails('boolean field loaded as DEBUG=0 is shown as False', async () => {
        await renderLoaded(SAMPLE.replace('DEBUG=true', 'DEBUG=0'));
        expect((input('DEBUG') as HTMLSelectElement).value).toBe('false');
    });
});

describe('input rendering', () => {
    test('renders the right control per type', async () => {
        await renderLoaded();
        const port = input('SAPIENT_PORT') as HTMLInputElement;
        expect(port.tagName).toBe('INPUT');
        expect(port.type).toBe('number');
        expect(port.min).toBe('1');
        expect(port.max).toBe('65535');
        const url = input('COT_URL') as HTMLInputElement;
        expect(url.type).toBe('text');
        expect(url.getAttribute('min')).toBeNull();
        const noRange = input('ZZ_NUM_NORANGE') as HTMLInputElement;
        expect(noRange.type).toBe('number');
        expect(noRange.getAttribute('min')).toBeNull();
        expect(input('DEBUG').tagName).toBe('SELECT');
        expect(input('SAPIENT_VERSION').tagName).toBe('SELECT');
        // An enum without options degrades to a text field.
        const noOpts = input('ZZ_ENUM_NOOPTS') as HTMLInputElement;
        expect(noOpts.tagName).toBe('INPUT');
        fireEvent.change(noOpts, { target: { value: 'anything' } });
        expect(noOpts.value).toBe('anything');
        expect(screen.getAllByText('Required').length).toBe(2);
        expect(screen.getByText(/Range: 1 - 65535/)).toBeTruthy();
        expect(screen.getByText(/Options: v2, v1/)).toBeTruthy();
    });
});

describe('saving', () => {
    test('saves with a trailing newline exactly once and shows success', async () => {
        await renderLoaded();
        fireEvent.change(input('SAPIENT_HOST'), { target: { value: 'new.host' } });
        submit();
        expect(await screen.findByText('Configuration saved.')).toBeTruthy();
        expect(h.replace).toHaveBeenCalledTimes(1);
        const written = h.replace.mock.calls[0][0];
        expect(written).toContain('SAPIENT_HOST=new.host');
        expect(written).toContain('OTHER_VAR=keepme');
        expect(written.endsWith('\n')).toBe(true);
        expect(written.endsWith('\n\n')).toBe(false);
        expect(h.restart).not.toHaveBeenCalled();
        expect(screen.queryByText(/unsaved changes/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Expand advanced' }));
        expect(rawPre().textContent).toContain('SAPIENT_HOST=new.host');
    });

    test('appends a newline when the serialized config lacks one', async () => {
        await renderLoaded('COT_URL=tcp://10.0.0.1:8087\nSAPIENT_HOST=h');
        submit();
        await screen.findByText('Configuration saved.');
        const written = h.replace.mock.calls[0][0];
        expect(written).toBe('COT_URL=tcp://10.0.0.1:8087\nSAPIENT_HOST=h\n');
    });

    test('shows the busy label while saving', async () => {
        let resolveReplace: (v: string) => void = () => {};
        h.replace.mockReturnValue(new Promise<string>(resolve => { resolveReplace = resolve }));
        await renderLoaded();
        submit();
        const busy = await screen.findByRole('button', { name: 'Saving…' });
        expect((busy as HTMLButtonElement).disabled).toBe(true);
        await act(async () => { resolveReplace('tag') });
        expect(await screen.findByRole('button', { name: 'Validate & Save' })).toBeTruthy();
    });

    test('save and restart success', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByLabelText('Restart sapientcot after save'));
        submit();
        expect(await screen.findByText('Configuration saved and service restarted.')).toBeTruthy();
        expect(h.restart).toHaveBeenCalledTimes(1);
    });

    test('restart failure with an Error shows a warning', async () => {
        h.restart.mockRejectedValue(new Error('unit not found'));
        await renderLoaded();
        fireEvent.click(screen.getByLabelText('Restart sapientcot after save'));
        submit();
        expect(await screen.findByText('Saved, but restart failed: unit not found')).toBeTruthy();
        expect(h.replace).toHaveBeenCalledTimes(1);
    });

    test('restart failure with a non-Error shows a warning', async () => {
        h.restart.mockRejectedValue('exit 5');
        await renderLoaded();
        fireEvent.click(screen.getByLabelText('Restart sapientcot after save'));
        submit();
        expect(await screen.findByText('Saved, but restart failed: exit 5')).toBeTruthy();
    });

    test('replace failure (Error) shows a danger toast', async () => {
        h.replace.mockRejectedValue(new Error('read-only fs'));
        await renderLoaded();
        submit();
        expect(await screen.findByText('Failed to update configuration file: read-only fs')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Validate & Save' })).toBeTruthy();
    });

    test('replace failure (non-Error) shows a danger toast', async () => {
        h.replace.mockRejectedValue('denied');
        await renderLoaded();
        submit();
        expect(await screen.findByText('Failed to update configuration file: denied')).toBeTruthy();
    });

    test('validation errors block the save', async () => {
        await renderLoaded();
        fireEvent.change(input('COT_URL'), { target: { value: 'not a url' } });
        submit();
        expect(await screen.findByText('Fix validation errors before saving.')).toBeTruthy();
        expect(h.replace).not.toHaveBeenCalled();
    });
});

describe('toasts', () => {
    test('child card toasts are shown and can be dismissed', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'svc-toast' }));
        expect(screen.getByText('svc toast')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'tls-toast' }));
        expect(screen.getByText('tls toast')).toBeTruthy();
        expect(screen.queryByText('svc toast')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByText('tls toast')).toBeNull();
    });
});

describe('card expansion', () => {
    test('toggles change aria-labels', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Collapse configuration' }));
        expect(screen.getByRole('button', { name: 'Expand configuration' })).toBeTruthy();
        expect(document.getElementById('envvar-input-COT_URL')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Expand configuration' }));
        expect(screen.getByRole('button', { name: 'Collapse configuration' })).toBeTruthy();

        expandDebug();
        fireEvent.click(screen.getByRole('button', { name: 'Collapse debug' }));
        expect(screen.getByRole('button', { name: 'Expand debug' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Expand advanced' }));
        fireEvent.click(screen.getByRole('button', { name: 'Collapse advanced' }));
        expect(screen.getByRole('button', { name: 'Expand advanced' })).toBeTruthy();
    });
});

describe('status output', () => {
    test('polls systemctl status every 4s and stops on unmount', async () => {
        vi.useFakeTimers();
        h.read.mockResolvedValue(SAMPLE);
        h.status.mockResolvedValueOnce('first status').mockResolvedValueOnce('second status');
        render(<Application />);
        await act(async () => { await vi.advanceTimersByTimeAsync(0) });
        expandDebug();
        expect(screen.getByText('Loading...')).toBeTruthy();
        await act(async () => { await vi.advanceTimersByTimeAsync(0) });
        expect(screen.getByText('first status')).toBeTruthy();
        await act(async () => { await vi.advanceTimersByTimeAsync(4000) });
        expect(screen.getByText('second status')).toBeTruthy();
        expect(h.status).toHaveBeenCalledTimes(2);

        // Collapsing unmounts StatusOutput: polling stops.
        fireEvent.click(screen.getByRole('button', { name: 'Collapse debug' }));
        await act(async () => { await vi.advanceTimersByTimeAsync(12000) });
        expect(h.status).toHaveBeenCalledTimes(2);
    });

    test('shows a failure message when status fails', async () => {
        h.status.mockRejectedValue(new Error('nope'));
        await renderLoaded();
        expandDebug();
        expect(await screen.findByText('Failed to get status output.')).toBeTruthy();
    });

    test('late results after unmount are ignored', async () => {
        let resolveOk: (v: string) => void = () => {};
        let rejectLate: (e: Error) => void = () => {};
        h.status
                .mockReturnValueOnce(new Promise<string>(resolve => { resolveOk = resolve }))
                .mockReturnValueOnce(new Promise<string>((_resolve, reject) => { rejectLate = reject }));
        await renderLoaded();
        expandDebug();
        fireEvent.click(screen.getByRole('button', { name: 'Collapse debug' }));
        expandDebug();
        fireEvent.click(screen.getByRole('button', { name: 'Collapse debug' }));
        await act(async () => {
            resolveOk('late');
            rejectLate(new Error('late'));
        });
        expect(screen.queryByText('late')).toBeNull();
        expect(screen.queryByText('Failed to get status output.')).toBeNull();
    });
});

describe('service logs', () => {
    test('initially shows placeholder', async () => {
        await renderLoaded();
        expandDebug();
        expect(logsPre().textContent).toBe('No logs to display.');
    });

    test('Show Logs displays output', async () => {
        h.logs.mockResolvedValue('Oct 17 sapientcot started');
        await renderLoaded();
        expandDebug();
        fireEvent.click(screen.getByRole('button', { name: 'Show Logs' }));
        await waitFor(() => expect(logsPre().textContent).toBe('Oct 17 sapientcot started'));
    });

    test('Show Logs with empty output', async () => {
        h.logs.mockResolvedValue('');
        await renderLoaded();
        expandDebug();
        fireEvent.click(screen.getByRole('button', { name: 'Show Logs' }));
        await waitFor(() => expect(logsPre().textContent).toBe('No logs found for this service.'));
    });

    test('Show Logs failure', async () => {
        h.logs.mockRejectedValue(new Error('x'));
        await renderLoaded();
        expandDebug();
        fireEvent.click(screen.getByRole('button', { name: 'Show Logs' }));
        await waitFor(() => expect(logsPre().textContent).toBe('Failed to retrieve service logs.'));
    });

    test('Follow Logs streams, refuses a second follow, and stops', async () => {
        await renderLoaded();
        expandDebug();
        fireEvent.click(screen.getByRole('button', { name: 'Follow Logs' }));
        expect(h.state.follows.length).toBe(1);
        act(() => {
            h.state.follows[0].emit('line1\n');
            h.state.follows[0].emit('line2\n');
        });
        expect(logsPre().textContent).toBe('line1\nline2\n');

        fireEvent.click(screen.getByRole('button', { name: 'Follow Logs' }));
        expect(h.state.follows.length).toBe(1);
        expect(logsPre().textContent).toBe('Already following logs.');

        fireEvent.click(screen.getByRole('button', { name: 'Stop Following' }));
        expect(h.close).toHaveBeenCalledTimes(1);
        expect(logsPre().textContent).toBe('Stopped following logs.');

        fireEvent.click(screen.getByRole('button', { name: 'Stop Following' }));
        expect(h.close).toHaveBeenCalledTimes(1);
        expect(logsPre().textContent).toBe('Not currently following logs.');
    });

    test('Stop Following when never followed', async () => {
        await renderLoaded();
        expandDebug();
        fireEvent.click(screen.getByRole('button', { name: 'Stop Following' }));
        expect(logsPre().textContent).toBe('Not currently following logs.');
        expect(h.close).not.toHaveBeenCalled();
    });

    test('done() resets so following can start again', async () => {
        await renderLoaded();
        expandDebug();
        fireEvent.click(screen.getByRole('button', { name: 'Follow Logs' }));
        act(() => { h.state.follows[0].finish() });
        fireEvent.click(screen.getByRole('button', { name: 'Follow Logs' }));
        expect(h.state.follows.length).toBe(2);
    });

    test('fail() shows a message and resets', async () => {
        await renderLoaded();
        expandDebug();
        fireEvent.click(screen.getByRole('button', { name: 'Follow Logs' }));
        act(() => { h.state.follows[0].error() });
        expect(logsPre().textContent).toBe('Failed to follow logs.');
        fireEvent.click(screen.getByRole('button', { name: 'Stop Following' }));
        expect(logsPre().textContent).toBe('Not currently following logs.');
    });

    test('closes the follow process on unmount', async () => {
        const { unmount } = await renderLoaded();
        expandDebug();
        fireEvent.click(screen.getByRole('button', { name: 'Follow Logs' }));
        unmount();
        expect(h.close).toHaveBeenCalledTimes(1);
    });

    test('unmount without following does not close anything', async () => {
        const { unmount } = await renderLoaded();
        unmount();
        expect(h.close).not.toHaveBeenCalled();
    });
});

describe('TLS install callback', () => {
    test('cert path fills PYTAK_TLS_CLIENT_CERT', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'tls-cert' }));
        expect((input('PYTAK_TLS_CLIENT_CERT') as HTMLInputElement).value).toBe('/etc/sapientcot/tls/cert.pem');
        expect((input('PYTAK_TLS_CLIENT_KEY') as HTMLInputElement).value).toBe('');
        expect(screen.getByText(/unsaved changes/)).toBeTruthy();
    });

    test('key path fills PYTAK_TLS_CLIENT_KEY and is saved', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'tls-key' }));
        expect((input('PYTAK_TLS_CLIENT_KEY') as HTMLInputElement).value).toBe('/etc/sapientcot/tls/key.pem');
        expect((input('PYTAK_TLS_CLIENT_CERT') as HTMLInputElement).value).toBe('');
        submit();
        await screen.findByText('Configuration saved.');
        expect(h.replace.mock.calls[0][0]).toContain('PYTAK_TLS_CLIENT_KEY=/etc/sapientcot/tls/key.pem');
    });

    test('no paths only marks the form dirty', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'tls-none' }));
        expect((input('PYTAK_TLS_CLIENT_CERT') as HTMLInputElement).value).toBe('');
        expect((input('PYTAK_TLS_CLIENT_KEY') as HTMLInputElement).value).toBe('');
        expect(screen.getByText(/unsaved changes/)).toBeTruthy();
    });

    test('ca path alone marks dirty but has no visible field', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'tls-ca' }));
        expect(screen.getByText(/unsaved changes/)).toBeTruthy();
        expect(document.getElementById('envvar-input-PYTAK_TLS_CLIENT_CAFILE')).toBeNull();
    });

    // BUG: onTlsInstalled stores the installed CA bundle path under
    // PYTAK_TLS_CLIENT_CAFILE, but that key is not in CONF_PARAMS. It is
    // therefore never rendered, and serializeEnvDefault (which only writes
    // keys present in the file's known lines or in CONF_PARAMS) silently
    // drops it, so the CA file the user just installed is never configured.
    test.fails('installed CA path is written to the config on save', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'tls-ca' }));
        submit();
        await screen.findByText('Configuration saved.');
        expect(h.replace.mock.calls[0][0]).toContain('PYTAK_TLS_CLIENT_CAFILE=/etc/sapientcot/tls/ca.pem');
    });
});
