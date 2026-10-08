// Führt js/tests.js im Terminal aus: gjs -m tests/run.js
import GLib from 'gi://GLib';
import System from 'system';

const dir = GLib.path_get_dirname(GLib.path_get_dirname(System.programPath));
for (const f of ['tariff.js', 'holidays.js', 'calc.js', 'tests.js']) {
  const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([dir, 'js', f]));
  (0, eval)(new TextDecoder().decode(bytes));
}

const results = globalThis.DR.tests.run();
for (const r of results) print((r.ok ? 'ok    ' : 'FAIL  ') + r.name + (r.ok ? '' : '\n      ' + r.error));
const failed = results.filter((r) => !r.ok).length;
print(`\n${results.length - failed}/${results.length} bestanden`);
System.exit(failed ? 1 : 0);
