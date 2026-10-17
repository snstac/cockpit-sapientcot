// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const created = vi.hoisted(() => ({ roots: [] as Root[], containers: [] as Element[] }));

// Stub the real page so the entry point can be exercised without Cockpit.
vi.mock('./app.jsx', () => ({
    Application: () => <p data-testid="stub-app">stub application</p>,
}));

// Stylesheets are bundled by esbuild in the real build; nothing to load here.
vi.mock('./patternfly-cockpit.scss', () => ({}));
vi.mock('./app.scss', () => ({}));

// Keep React's real createRoot, but record what index.tsx asks it to do.
vi.mock('react-dom/client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom/client')>();
    return {
        ...actual,
        createRoot: vi.fn((container: Element) => {
            const root = actual.createRoot(container);
            created.roots.push(root);
            created.containers.push(container);
            return root;
        }),
    };
});

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Re-evaluate index.tsx inside the current test so its listener is registered
// against this test's document. (vi.importActual rather than `import()`: the
// project's tsconfig module target has no dynamic-import syntax. Dependencies
// of the imported module still resolve through the vi.mock registry.)
async function loadEntryPoint(): Promise<void> {
    vi.resetModules();
    await vi.importActual('./index');
}

describe('index.tsx entry point', () => {
    let app: HTMLDivElement;
    let addSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        created.roots.length = 0;
        created.containers.length = 0;
        app = document.createElement('div');
        app.id = 'app';
        document.body.appendChild(app);
        addSpy = vi.spyOn(document, 'addEventListener');
    });

    afterEach(() => {
        act(() => {
            for (const root of created.roots)
                root.unmount();
        });
        // Drop the listeners this test's import registered so later tests start clean.
        for (const call of addSpy.mock.calls) {
            const [type, listener] = call as [string, EventListener];
            document.removeEventListener(type, listener);
        }
        addSpy.mockRestore();
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    test('registers a single DOMContentLoaded listener and renders nothing on import', async () => {
        await loadEntryPoint();

        const domReady = addSpy.mock.calls.filter(([type]: unknown[]) => type === 'DOMContentLoaded');
        expect(domReady).toHaveLength(1);
        expect(typeof domReady[0]?.[1]).toBe('function');

        expect(createRoot).not.toHaveBeenCalled();
        expect(app.childNodes).toHaveLength(0);
        expect(document.querySelector('[data-testid="stub-app"]')).toBeNull();
    });

    test('renders the Application into #app once DOMContentLoaded fires', async () => {
        await loadEntryPoint();

        await act(async () => {
            document.dispatchEvent(new Event('DOMContentLoaded'));
        });

        expect(createRoot).toHaveBeenCalledTimes(1);
        expect(created.containers[0]).toBe(app);
        const rendered = app.querySelector('[data-testid="stub-app"]');
        expect(rendered).not.toBeNull();
        expect(rendered?.textContent).toBe('stub application');
        // Rendered inside #app and nowhere else.
        expect(document.querySelectorAll('[data-testid="stub-app"]')).toHaveLength(1);
        expect(app.children).toHaveLength(1);
    });

    test('ignores unrelated events', async () => {
        await loadEntryPoint();

        await act(async () => {
            document.dispatchEvent(new Event('load'));
            window.dispatchEvent(new Event('DOMContentLoaded'));
        });

        expect(createRoot).not.toHaveBeenCalled();
        expect(app.childNodes).toHaveLength(0);
    });
});
