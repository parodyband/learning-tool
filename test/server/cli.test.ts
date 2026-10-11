// The commands for people, called in process: `verify` in its finer points, and `voice-check` with
// voice off. (The spawned binary is exercised in stdio.test.ts, and voice-check against the stub in
// voice.test.ts.)
import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RULES_VERSION } from '../../src/core/limits';
import { verifyLesson } from '../../src/core/validate';
import { buildId, stampedVersion } from '../../src/server/build-id';
import { formatVerify, runVerify, runVoiceCheck, USAGE, verifyFile } from '../../src/server/cli';
import { NOON, startWorld, written, type World } from './helpers/kit';

let w: World;
let file: string;
let lessonId: string;
beforeEach(async () => {
  w = await startWorld({ deps: { now: () => NOON } });
  lessonId = await written(w);
  file = (await w.call('publish_lesson', { lessonId })).file.path;
});
afterEach(async () => {
  await w.close();
});

const rewrite = async (edit: (html: string) => string): Promise<void> => {
  const html = await readFile(file, 'utf8');
  const edited = edit(html);
  expect(edited).not.toBe(html);
  await writeFile(file, edited);
};

const DATA = 'id="lt-data"';
/** Change the page a learner reads and leave the embedded data, hash and receipt exactly as they are. */
const editVisible = (html: string): string => {
  const at = html.indexOf(DATA);
  const visible = 'throws away the half where the value cannot be';
  expect(html.slice(0, at)).toContain(visible);
  return html.slice(0, at).replace(visible, 'keeps only the half where the value cannot be') + html.slice(at);
};
const run = async (...argv: string[]): Promise<{ code: number; text: string }> => {
  const lines: string[] = [];
  const code = await runVerify(argv, { out: (l) => lines.push(l), err: (l) => lines.push(l) });
  return { code, text: lines.join('\n') };
};
const REASSURANCE = 'This shows the lesson is the one that was validated';

describe('verify', () => {
  it('reports everything it checked', async () => {
    const result = await verifyFile(file);
    expect(result).toEqual({
      ok: true,
      dataOk: true,
      file,
      problems: [],
      errors: [],
      warnings: 0,
      lesson: { id: lessonId, title: 'Binary search: find anything in a sorted list, fast', scenes: 9, sources: 5 },
      rules: { receipt: RULES_VERSION, current: RULES_VERSION },
      hash: { receipt: expect.stringMatching(/^[0-9a-f]{64}$/), computed: expect.stringMatching(/^[0-9a-f]{64}$/), matches: true },
      receiptMatches: true,
      page: { result: 'identical' },
    });
    expect(result.hash!.computed).toBe(result.hash!.receipt);
  });

  it('says in plain words what a pass does and does not show', async () => {
    const text = formatVerify(await verifyFile(file));
    expect(text.split('\n')[0]).toBe('OK  "Binary search: find anything in a sorted list, fast"');
    expect(text).toContain(`lesson   ${lessonId}: 9 scenes, 5 passages`);
    expect(text).toContain('It does not show that its excerpts are genuine');
    // The hash is stored in the file it describes: a pass must not be read as proof against a deliberate rebuild.
    expect(text).toContain('The hash is not a signature: it catches damage and plain edits, not a file rebuilt on purpose.');
    expect(text).toContain(`${REASSURANCE}, that it still passes, and that the page is what it renders to.`);
    expect(text).not.toMatch(/\bverified\b/i);
  });

  describe('a page whose visible text was edited, with its data left alone', () => {
    // V7, M3, A9: this printed "OK", "page DIFFERS", then "This shows the lesson is the one that was
    // validated and that it still passes", and exited 0. What a learner reads is the page.
    beforeEach(async () => {
      await rewrite(editVisible);
    });

    it('fails: the data holds, the page does not, and the result says which', async () => {
      const result = await verifyFile(file);
      expect(result).toMatchObject({ ok: false, dataOk: true, hash: { matches: true }, receiptMatches: true, errors: [] });
      expect(result.page).toEqual({ result: 'differs', why: expect.stringContaining('the file was changed after it was published') });
      expect(result.problems).toEqual(['The visible page is not what its own data renders to.']);
    });

    it('is reported as DATA OK, PAGE DIFFERS with exit status 1, and never with the reassurance', async () => {
      const { code, text } = await run(file);
      expect(code).toBe(1);
      expect(text.split('\n')[0]).toBe('DATA OK, PAGE DIFFERS  "Binary search: find anything in a sorted list, fast"');
      expect(text).toContain('matches the receipt');
      expect(text).toContain('page     DIFFERS: this build made the page, and the page is no longer what it renders from the embedded data');
      expect(text).toContain('The embedded lesson is the one that was validated, and it still passes. The visible page is not what it renders to, so what a learner reads here is not the validated lesson.');
      expect(text).not.toContain(REASSURANCE);
      expect(text).not.toMatch(/^OK/);
      expect((await run(file, '--strict')).code).toBe(1);
      expect(JSON.parse((await run(file, '--json')).text)).toMatchObject({ ok: false, dataOk: true, page: { result: 'differs' } });
    });

    it('--data-only skips the page: exit 0, and the result says the page was not compared', async () => {
      const { code, text } = await run(file, '--data-only');
      expect(code).toBe(0);
      expect(text.split('\n')[0]).toBe('DATA OK, PAGE NOT COMPARED  "Binary search: find anything in a sorted list, fast"');
      expect(text).toContain('page     not compared: --data-only was given');
      expect(text).toContain('Only the embedded data was checked');
      expect(text).toContain('this does not show that the page is what the data renders to');
      expect(text).not.toContain(REASSURANCE);
      expect(await verifyFile(file, { dataOnly: true })).toMatchObject({ ok: true, dataOk: true, page: { result: 'not-checked', why: '--data-only was given' } });
    });

    it.each([
      ['a tag that makes the page look as if it carried audio', (html: string) => html.replace('</body>', '<script type="application/octet-stream" data-seg="s1">AAAA</script></body>'), /page {5}not compared: the page carries narration audio/],
      ['the same tag inside a comment', (html: string) => html.replace('</body>', '<!-- <script type="application/octet-stream" --></body>'), /page {5}not compared: the page carries narration audio/],
      ['a receipt that names another build', (html: string) => html.replace(`"version":"${stampedVersion(w.deps.version)}"`, '"version":"0.0.9"'), /page {5}not compared: the page was made by another build of Learning Tool \(0\.0\.9; this is /],
    ])('cannot be passed off as proven by %s: --strict fails, and without it nothing claims the page was checked', async (_name, edit, line) => {
      // M3: each of these switched the comparison off, and --strict then printed OK and exited 0.
      await rewrite(edit);
      const strict = await run(file, '--strict');
      expect(strict.code).toBe(1);
      expect(strict.text.split('\n')[0]).toMatch(/^DATA OK, PAGE NOT COMPARED {2}"/);
      expect(strict.text).toMatch(line);
      expect(strict.text).toContain('! The visible page could not be compared with its data, and --strict passes only a page proven identical.');
      expect(strict.text).not.toContain(REASSURANCE);
      const plain = await run(file);
      expect(plain.code).toBe(0);
      expect(plain.text.split('\n')[0]).toMatch(/^DATA OK, PAGE NOT COMPARED {2}"/);
      expect(plain.text).toContain('Only the embedded data was checked');
      expect(plain.text).not.toContain(REASSURANCE);
      expect(plain.text).not.toMatch(/^OK/);
    });
  });

  it('fails a file whose data was edited and whose hash was recomputed to match, with the page left as it was', async () => {
    // The hash is stored in the file it describes, so anyone can recompute it. The data then "holds",
    // and only the page, which still shows the old sentence, gives the edit away. This used to print OK.
    await rewrite((html) => {
      const edited = html.replace('"text":"Follow the arrows once before you read any code."', '"text":"Follow the arrows twice before you read any code."');
      const data = JSON.parse(edited.slice(edited.indexOf('>', edited.indexOf(DATA)) + 1, edited.indexOf('</script', edited.indexOf(DATA))));
      const recomputed = verifyLesson(data.lesson).hash as string;
      expect(recomputed).toMatch(/^[0-9a-f]{64}$/);
      return edited.replace(/"hash":"[0-9a-f]{64}"/, `"hash":"${recomputed}"`);
    });
    const result = await verifyFile(file);
    expect(result).toMatchObject({ ok: false, dataOk: true, hash: { matches: true }, receiptMatches: true, page: { result: 'differs' } });
    const { code, text } = await run(file);
    expect(code).toBe(1);
    expect(text).toMatch(/^DATA OK, PAGE DIFFERS/);
    expect(text).not.toContain(REASSURANCE);
    // With the page left out of it there is nothing left to notice, which is why --data-only says how little it shows.
    const dataOnly = await run(file, '--data-only');
    expect(dataOnly.code).toBe(0);
    expect(dataOnly.text).toContain('The hash is not a signature');
    expect(dataOnly.text).not.toContain(REASSURANCE);
  });

  it('prints the reassurance only for a page proven identical', async () => {
    const untouched = await run(file);
    expect(untouched.code).toBe(0);
    expect(untouched.text).toMatch(/^OK {2}"/);
    expect(untouched.text).toContain(REASSURANCE);
    expect((await run(file, '--strict')).code).toBe(0);
    // The data alone, on the same untouched file: true, but not everything, so the headline and the sentence say less.
    const dataOnly = await run(file, '--data-only');
    expect(dataOnly.code).toBe(0);
    expect(dataOnly.text).toMatch(/^DATA OK, PAGE NOT COMPARED {2}"/);
    expect(dataOnly.text).not.toContain(REASSURANCE);
  });

  it('records the build in the receipt, and compares pages only with the build that made them', async () => {
    // The package version does not change between builds. Without the build, a page from an earlier
    // build of the same version would differ from this one's rendering without anyone having edited it.
    expect(buildId()).toMatch(/^[0-9a-f]{8}$/);
    expect(stampedVersion('0.1.0')).toBe(`0.1.0+${buildId()}`);
    const html = await readFile(file, 'utf8');
    expect(html).toContain(`"version":"${w.deps.version}+${buildId()}"`);
    // A page from "another build of the same version": honest, and so not failed, but not called proven either.
    await rewrite((page) => page.replace(`"version":"${stampedVersion(w.deps.version)}"`, `"version":"${w.deps.version}+00000000"`));
    const result = await verifyFile(file);
    expect(result).toMatchObject({ ok: true, dataOk: true, page: { result: 'not-checked' } });
    expect(result.page!.why).toContain(`${w.deps.version}+00000000; this is ${stampedVersion(w.deps.version)}`);
    expect((await run(file)).text).toMatch(/^DATA OK, PAGE NOT COMPARED/);
  });

  it('shows a version from the file only when it has the form of one', async () => {
    await rewrite((page) => page.replace(`"version":"${stampedVersion(w.deps.version)}"`, '"version":"\\u001b[31mrun this\\u001b[0m"'));
    const { text } = await run(file);
    expect(text).toContain('another build of Learning Tool (unknown; this is');
    expect(text).not.toContain('run this');
  });

  it('prints nothing from the file that could drive a terminal', async () => {
    // A report is read in a terminal, and everything in the file is somebody else's text.
    await rewrite((page) => page.replace('"title":"Binary search: find anything in a sorted list, fast"', '"title":"Binary \\u001b[2Jsearch"').replace(`"rules":"${RULES_VERSION}"`, '"rules":"\\u001b]0;x\\u0007"'));
    const { text, code } = await run(file);
    expect(code).toBe(1);
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect(text.split('\n')[0]).toBe('FAILED  "Binary  [2Jsearch"');
  });

  it('prints JSON on request', async () => {
    const lines: string[] = [];
    const code = await runVerify([file, '--json'], { out: (l) => lines.push(l), err: (l) => lines.push(l) });
    expect(code).toBe(0);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ ok: true, hash: { matches: true } });
  });

  it('lists the validation errors of a lesson that no longer passes, by code, scene and path', async () => {
    await rewrite((html) => html.replace('"text":"A linear search may have to check every one of the n elements."', '"text":"A linear search may have to check all 4096 of the n elements."'));
    const result = await verifyFile(file);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({ code: 'NUMBER_NOT_IN_SOURCE', sceneId: 's5', path: 'blocks[0].text' });
    expect(result.hash).toMatchObject({ computed: null, matches: false });
    const text = formatVerify(result);
    expect(text).toMatch(/^FAILED/);
    expect(text).toContain('NUMBER_NOT_IN_SOURCE s5 blocks[0].text');
    expect(text).not.toContain('It does not show that its excerpts are genuine');
  });

  it('checks a lesson published under other rules against this build\'s rules, and says so', async () => {
    // A lesson from an earlier release: other rules, and so another build.
    await rewrite((html) => html.replace(`"rules":"${RULES_VERSION}"`, '"rules":"0"').replace(`"version":"${stampedVersion(w.deps.version)}"`, '"version":"0.0.9"'));
    const result = await verifyFile(file);
    expect(result.rules).toEqual({ receipt: '0', current: RULES_VERSION });
    // It still passes today's rules and its hash still matches, so it holds. The receipt's counts were made by other rules and are not compared.
    expect(result.ok).toBe(true);
    expect(result.receiptMatches).toBeUndefined();
    expect(formatVerify(result)).toContain(`published under version 0; this build checks version ${RULES_VERSION}`);
  });

  it('does not compare the page when another version made it: that is said, and only --strict makes it a failure', async () => {
    await rewrite((html) => html.replace(`"version":"${stampedVersion(w.deps.version)}"`, '"version":"9.9.9"'));
    const result = await verifyFile(file);
    expect(result.page).toEqual({ result: 'not-checked', why: `the page was made by another build of Learning Tool (9.9.9; this is ${stampedVersion(w.deps.version)}), and only the build that made a page draws it the same way` });
    expect(result).toMatchObject({ ok: true, dataOk: true });
    expect(formatVerify(result)).toContain('page     not compared');
    const strict = await verifyFile(file, { strict: true });
    expect(strict).toMatchObject({ ok: false, dataOk: true, page: { result: 'not-checked' } });
    expect(strict.problems).toEqual(['The visible page could not be compared with its data, and --strict passes only a page proven identical.']);
  });

  it('a receipt with a field removed fails, rather than passing by default', async () => {
    await rewrite((html) => html.replace(/"hash":"[0-9a-f]{64}",/, ''));
    const result = await verifyFile(file);
    expect(result.ok).toBe(false);
    expect(result.hash).toMatchObject({ receipt: null, matches: false });
  });

  it('usage errors exit 1 and print how to call it', async () => {
    const lines: string[] = [];
    const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    expect(await runVerify([], io)).toBe(1);
    expect(await runVerify([file, file], io)).toBe(1);
    expect(await runVerify([file, '--loose'], io)).toBe(1);
    // "Prove the page" and "leave the page alone" cannot both be meant.
    expect(await runVerify([file, '--strict', '--data-only'], io)).toBe(1);
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l === 'Usage: learning-tool.mjs verify <file.html> [--data-only | --strict] [--json]')).toBe(true);
    expect(USAGE).toContain('--data-only');
    expect(USAGE).toContain('Exit 0 when it holds, 1 when the data fails or the page differs.');
    expect(USAGE).toContain('verify <file.html>');
    expect(USAGE).toContain('voice-check');
  });
});

describe('voice-check with voice off', () => {
  it('reports it and asks nothing of the network', async () => {
    const lines: string[] = [];
    const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    const never = (async () => {
      throw new Error('voice-check contacted the network with voice off');
    }) as unknown as typeof fetch;
    expect(await runVoiceCheck([], io, {}, { fetch: never })).toBe(0);
    expect(lines[0]).toMatch(/^VOICE_OFF: Voice is off/);
    // The generic variable is not ours and does not turn voice on.
    expect(await runVoiceCheck(['--json'], io, { ELEVENLABS_API_KEY: 'sk_some_other_tools_key_1234567890' }, { fetch: never })).toBe(0);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ code: 'VOICE_OFF', configured: false });
  });

  it('a malformed setting is a failure, named without its value', async () => {
    const lines: string[] = [];
    const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    const code = await runVoiceCheck([], io, { LEARNING_TOOL_ELEVENLABS_API_KEY: 'short' }, {});
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('LEARNING_TOOL_ELEVENLABS_API_KEY');
    expect(lines.join('\n')).not.toContain('short');
  });
});
