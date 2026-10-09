// Linked with --pre-js, so it shares scope with Emscripten's JS SDL (`SDL`).
// The page calls this from its click-to-start handler: browsers only let an
// AudioContext run once it has been created or resumed inside a user gesture.
// If the game has not opened audio yet, the context is created here, and
// Mix_OpenAudio reuses it.
window.abuseUnlockAudio = function () {
  var AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (typeof SDL === 'undefined' || !AC) return;
  if (!SDL.audioContext) SDL.audioContext = new AC();
  if (SDL.audioContext.state === 'suspended') SDL.audioContext.resume();
};
