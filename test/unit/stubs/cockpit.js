// Minimal stand-in for the `cockpit` module, which only exists inside a
// running Cockpit session. Tests replace the pieces they exercise with
// vi.mock('cockpit', ...) or vi.spyOn().
const cockpit = {
    gettext: s => s,
    file() {
        throw new Error('cockpit.file() not mocked in this test');
    },
    spawn() {
        throw new Error('cockpit.spawn() not mocked in this test');
    },
};

export default cockpit;
