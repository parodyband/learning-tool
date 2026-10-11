// The static checks of a custom frame, as the validator reaches them.
//
// Why this file is JavaScript and has a hand-written declaration beside it (frame-check.d.ts):
// src/frame/check.ts is Node-only (it parses the code with node:vm), and everything under src/core
// is also type-checked for the browser by src/player/tsconfig.json, which has no Node types. A
// plain import of src/frame/check from the validator would pull that file into the browser's type
// check and fail it. TypeScript reads the declaration and stops there; the bundlers and the test
// runner read this file and load the real module. test/validate/frame-bridge.test.ts holds the
// declaration equal to what src/frame/check.ts exports.
//
// If src/frame/check.ts ever stops needing Node, delete both files and import it directly.
export { FRAME_ISSUES, checkFrame, checkFrameBeats } from '../../frame/check';
