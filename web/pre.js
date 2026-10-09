// Runs before the Emscripten runtime starts. Extra command-line flags can be
// passed in the URL: index.html?args=-nosound
Module['arguments'] = (new URLSearchParams(location.search).get('args') || '')
  .split(' ').filter(Boolean);
