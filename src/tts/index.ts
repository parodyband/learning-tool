// Optional voice for a published lesson, through ElevenLabs. This file is the whole public surface.
//
// How the server uses it:
//
//   const config = voiceConfigFromEnv(process.env);        // null means voice is off
//   const { clips, report, audio } = await synthesizeLesson(narrationSegments(lesson), config, {
//     cacheDir: path.join(home, '.state', 'voice-cache'),
//     deadlineMs: 45_000,
//   });
//   if (audio) published.audio = audio;                    // report.code says whether it is complete
//
// What it guarantees:
//   - The key is read from LEARNING_TOOL_ELEVENLABS_API_KEY and held in a closure. It is in no
//     object this module returns, no error it throws, no file it writes, and it logs nothing.
//   - The key is sent to https://api.elevenlabs.io and nowhere else. Redirects are refused. The only
//     override is a loopback token minted in test code (src/tts/testing), which is not JSON and so
//     cannot arrive in a tool argument or a draft.
//   - A report is made of fixed codes and sentences, counts, and ids validated here. It never
//     contains a response body or a header value.
//   - `synthesizeLesson` and `voiceCheck` resolve for every runtime failure. Whatever goes wrong
//     with voice, the text lesson is unaffected.
//
// Not proven: no API key was available when this was written, so every request and response shape
// comes from the ElevenLabs documentation and was exercised against a local stub only.
export { VOICE_CODES, VOICE_MESSAGES } from './codes';
export type { VoiceCode, VoiceFailureCode } from './codes';
export { voiceConfigFromEnv, voiceEnvProblems } from './config';
export type { VoiceConfig, VoiceEnv, VoiceEnvProblem } from './config';
export { synthesizeLesson, voiceCharacters, DEFAULT_DEADLINE_MS, OUTPUT_FORMAT } from './synthesize';
export type { SynthesisResult, SynthesizeOptions, VoiceReport, VoiceSegmentReport, VoiceSegmentStatus } from './synthesize';
export { voiceCheck, formatVoiceCheck } from './check';
export type { VoiceCheckOptions, VoiceCheckReport, VoiceEndpointCheck } from './check';
export { ELEVENLABS_ORIGIN } from './origin';
export type { TestBaseUrl } from './origin';
