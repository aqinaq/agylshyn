/* The shared tally. Every suite prints the same way and exits non-zero if
   anything failed, so `node tests/run.js` can just chain them. */
'use strict';

function Report(title) {
  const r = {
    pass: 0, fail: 0, warn: 0,
    // stderr, not stdout: node block-buffers stdout when it is redirected to a
    // file, and a suite that dies halfway would then print nothing at all.
    log: m => process.stderr.write(m + '\n'),
    head(m) { r.log('\n### ' + m); },
    note(m) { r.log('    ' + m); },
    ok(name, cond, detail) {
      if (cond) { r.pass++; r.log('  ✓ ' + name); }
      else { r.fail++; r.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
      return !!cond;
    },
    eq(name, got, want) {
      return r.ok(name, got === want,
        'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
    },
    warnIf(cond, m) { if (cond) { r.warn++; r.log('  ! ' + m); } },
    done() {
      r.log('\n=== ' + title + ': ' + r.pass + ' passed, ' + r.fail + ' failed'
        + (r.warn ? ', ' + r.warn + ' warnings' : '') + ' ===');
      return r.fail;
    }
  };
  r.log('\n========== ' + title + ' ==========');
  return r;
}

module.exports = { Report };
