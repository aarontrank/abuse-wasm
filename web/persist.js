// Persist Abuse's save directory ($HOME/.abuse: gamma.lsp, abuserc, light.tbl,
// save000N.spe, ...) in IndexedDB via IDBFS. Loaded as a second --pre-js.
//
// IDBFS is mounted on a private staging directory, never on the save dir
// itself: a populate cannot be cancelled, and one that lands after the timeout
// below would otherwise reconcile the live save dir and delete saves made since.
//
// Startup: preRun populates the staging dir and holds main() behind a run
// dependency until it is copied into the save dir. Any failure (no IndexedDB,
// private mode, quota, a hung open) releases the dependency and the game runs on
// plain MEMFS, with one console line saying so.
//
// Writes: every close of a writable stream under the save dir schedules one
// debounced mirror into staging + FS.syncfs(false); pagehide/hidden flush.
//
// Reset: load the page with ?reset=1 to delete the store before mounting.
(function () {
  var DIR = '/home/web_user/.abuse';
  var STAGE = '/abuse-store'; // IDBFS mount; also the IndexedDB database name
  var DEBOUNCE_MS = 250;
  var POPULATE_TIMEOUT_MS = 5000;
  var tag = '[persist]';

  var enabled = false; // only true once the store has been read in cleanly
  var dirty = false;
  var inFlight = false;
  var timer = 0;

  function sync() {
    clearTimeout(timer); timer = 0;
    if (!enabled || !dirty) return;
    if (inFlight) return; // re-run from the completion callback
    dirty = false; inFlight = true;
    // On either failure stay dirty without re-arming the timer: the next write
    // or the pagehide/hidden flush retries, and a persistent failure cannot spin.
    try { mirror(DIR, STAGE); } catch (e) { inFlight = false; dirty = true; return console.warn(tag, 'save failed:', e); }
    FS.syncfs(false, function (err) {
      inFlight = false;
      if (err) { dirty = true; return console.warn(tag, 'save to IndexedDB failed:', err); }
      if (dirty) schedule();
    });
  }
  function schedule() {
    dirty = true;
    if (!timer) timer = setTimeout(sync, DEBOUNCE_MS);
  }

  function entries(dir) {
    return FS.readdir(dir).filter(function (n) { return n !== '.' && n !== '..'; });
  }
  function remove(path) {
    if (FS.isDir(FS.stat(path).mode)) {
      entries(path).forEach(function (n) { remove(path + '/' + n); });
      FS.rmdir(path);
    } else {
      FS.unlink(path);
    }
  }
  // Make dst an exact copy of src, deletions included.
  function mirror(src, dst) {
    var names = entries(src);
    entries(dst).forEach(function (n) { if (names.indexOf(n) < 0) remove(dst + '/' + n); });
    names.forEach(function (n) {
      var a = src + '/' + n, b = dst + '/' + n;
      if (FS.isDir(FS.stat(a).mode)) {
        try { FS.mkdir(b); } catch (e) {}
        mirror(a, b);
      } else {
        FS.writeFile(b, FS.readFile(a));
      }
    });
  }

  function hookClose() {
    var close = FS.close;
    var prefix = DIR + '/';
    FS.close = function (stream) {
      var wrote = (stream.flags & 3) !== 0 && // O_WRONLY | O_RDWR
                  typeof stream.path === 'string' && stream.path.indexOf(prefix) === 0;
      var r = close.apply(this, arguments);
      if (wrote) schedule();
      return r;
    };
    addEventListener('pagehide', sync);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') sync();
    });
  }

  function deleteStore(done) {
    // IDBFS names its database after the mount point.
    // Only a completed delete continues to the populate. A throw, an error or a
    // block leaves the old store in place, so the populate guard in setup()
    // starts the game without persistence and the flag stays for a retry.
    var req;
    try { req = indexedDB.deleteDatabase(STAGE); } catch (e) { return console.log(tag, 'reset failed:', e); }
    req.onsuccess = function () {
      // Drop the flag only now, so a finished reset is not repeated on reload.
      try {
        var u = new URL(location.href);
        u.searchParams.delete('reset');
        history.replaceState(null, '', u.toString());
      } catch (e) {}
      done();
    };
    req.onerror = function () { console.log(tag, 'reset failed:', req.error); };
    req.onblocked = function () { console.log(tag, 'reset waiting for another tab to close the store'); };
  }

  function setup() {
    try { FS.mkdirTree(DIR); } catch (e) {}
    var hasIDB = false;
    try { hasIDB = typeof indexedDB !== 'undefined' && !!indexedDB; } catch (e) {}
    if (!hasIDB) {
      console.log(tag, 'IndexedDB unavailable; settings and saves will not persist');
      return;
    }
    try {
      FS.mkdirTree(STAGE);
      FS.mount(IDBFS, {}, STAGE);
    } catch (e) {
      console.log(tag, 'IDBFS mount failed; settings and saves will not persist:', e);
      return;
    }

    var dep = 'abuse-persist';
    var released = false;
    function release(ok, msg) {
      if (released) return;
      released = true;
      clearTimeout(guard);
      if (ok) { enabled = true; hookClose(); }
      console.log(tag, msg);
      removeRunDependency(dep);
    }
    var guard = setTimeout(function () {
      // A late populate only fills STAGE, which is never copied in after this.
      release(false, 'IndexedDB did not answer; settings and saves will not persist');
    }, POPULATE_TIMEOUT_MS);
    addRunDependency(dep);

    var reset = /[?&]reset=1(&|$)/.test(location.search);
    (reset ? deleteStore : function (f) { f(); })(function () {
      FS.syncfs(true, function (err) {
        if (err) {
          release(false, 'IndexedDB unusable (' + (err.name || err.message || err) +
                         '); settings and saves will not persist');
        } else if (released) {
          // Answered after the timeout: the game is already running without it.
        } else {
          try { mirror(STAGE, DIR); } catch (e) { return release(false, 'restore failed (' + e + '); settings and saves will not persist'); }
          var n = entries(DIR).length;
          release(true, (reset ? 'store reset; ' : '') + 'restored ' + n + ' file(s) from IndexedDB');
        }
      });
    });
  }

  Module['preRun'] = [].concat(Module['preRun'] || [], setup);
})();
