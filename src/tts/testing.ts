// Test-only entry point. Production code imports `src/tts` (index.ts), which does not export this
// function, so the bundled server contains no way to point the voice module anywhere but ElevenLabs.
export { loopbackBaseUrl } from './origin';
export type { TestBaseUrl } from './origin';
