// The `lines` and `timeline` stage kits in the real page: a lesson made of their four example
// clips, rendered by the product's renderer and played by the product's player, in Chromium and
// WebKit. Each kit builds and plays, shows the same picture at an instant however that instant was
// reached, steps, shows end states under reduced motion, fits 320 pixels, and passes axe.
//
// The clip is driven only through its own controls: the Play button, Next, and the scrubber (an
// `input` event on the range, which is what a drag or an arrow key sends).
import type { Locator, Page, TestInfo } from '@playwright/test';
import { ClipScene } from '../../src/core/clip';
import { EXTRA_EXAMPLE_CLIPS } from '../../src/core/clip-kits-extra-examples';
import type { Published } from '../../src/core/types';
import { renderLinesStage, renderTimelineStage } from '../../src/render/clip-kits-extra';
import { attrs, domId, internalId } from '../../src/render/escape';
import { examplePublished } from '../helpers/example';
import { pageWidth } from './questions-kit';
import { type Watch, expect, expectClean, openLesson, test } from './shell-kit';

const CODE_LABEL = 'Code written by your agent. Read it before you run it.';
const IDS = EXTRA_EXAMPLE_CLIPS.map((c) => c.id);

/**
 * Three more clips, for the verbs and layouts the four examples do not use: plain text lines with
 * two labelled pointers, a bracket that slides, a line rewritten where it stands and every tone; a
 * single track with enough events to set them above and below it; and lanes whose events are
 * brought by `show`, with a span that slides and a focus on a lane and on a span.
 */
const framing = (text: string) => ({ type: 'framing' as const, text });
const MORE = [
  {
    id: 'morelines',
    kind: 'clip',
    title: 'Every move on lines',
    description: 'Six lines of plain text with two pointers, a bracket, two annotations and three values, put through every verb the lines stage takes.',
    stage: {
      kind: 'lines',
      format: 'text',
      lines: ['Pick the middle item of the interval that is left to search.', 'If it is the target, stop.', 'If it is too small, drop the left half.', 'If it is too big, drop the right half.', 'Repeat with what is left.', 'An empty interval means it is not there.'],
      pointers: [{ id: 'here', label: 'here' }, { id: 'next', label: 'next', tone: 'warn' }],
      brackets: [{ id: 'choice', label: 'one of these' }, { id: 'bare' }],
      annotations: [{ id: 'note1', at: 'l1', text: 'The middle, not the first: that is what halves the work.' }, { id: 'note2', at: 'l5', text: 'Each repeat halves it again.', tone: 'good' }],
      values: [{ id: 'left', at: 'l1', label: 'left', value: 64, unit: ' items' }, { id: 'tries', at: 'l5', label: 'tries' }, { id: 'verdict', at: 'l6', value: 'rare' }],
      stats: [{ id: 'steps', label: 'Steps', value: 0 }],
      cites: [],
      provenance: 'illustrative',
    },
    beats: [
      { caption: framing('Lines arrive in groups, and a pointer lands.'), do: [{ verb: 'show', targets: ['l5', 'l6'] }, { verb: 'move', target: 'here', to: 'l1' }, { verb: 'move', target: 'next', to: 'l2', with: true }, { verb: 'show', target: 'note1' }] },
      { caption: framing('A bracket closes round a range, then slides.'), do: [{ verb: 'move', target: 'choice', to: ['l2', 'l4'] }, { verb: 'move', target: 'bare', to: 'l6' }, { verb: 'move', target: 'choice', to: ['l3', 'l4'] }, { verb: 'set', target: 'choice', label: 'two ways on', tone: 'good' }] },
      { caption: framing('Values tick over, one arrives, and lines take tones.'), do: [{ verb: 'set', target: 'left', value: 32 }, { verb: 'set', target: 'tries', value: 1, with: true }, { verb: 'set', targets: ['l3', 'l4'], tone: 'warn' }, { verb: 'set', target: 'l6', tone: 'bad' }] },
      { caption: framing('A line is rewritten where it stands; pointers jump and change.'), do: [{ verb: 'set', target: 'l2', label: 'If it is the target, stop: found.' }, { verb: 'move', target: 'here', to: 'l5' }, { verb: 'set', target: 'next', label: 'then', tone: 'accent' }, { verb: 'move', target: 'next', to: 'l6' }] },
      { caption: framing('A value in focus brings its line; the camera moves in.'), do: [{ verb: 'focus', targets: ['tries'], zoom: true }, { verb: 'show', target: 'note2' }, { verb: 'pulse', targets: ['l5', 'tries', 'steps'] }, { verb: 'set', target: 'steps', value: 5, tone: 'good' }] },
      { caption: framing('Things leave, and come back.'), do: [{ verb: 'focus' }, { verb: 'hide', targets: ['l6', 'note1', 'note2', 'bare', 'next'] }, { verb: 'set', targets: ['l3', 'l4'], tone: 'muted' }, { verb: 'show', targets: ['l6', 'next', 'verdict'] }] },
      { caption: framing('A range in focus, by its first and last line.'), do: [{ verb: 'focus', between: ['l1', 'l2'] }, { verb: 'set', between: ['l1', 'l2'], tone: 'accent' }, { verb: 'hide', targets: ['choice', 'here'] }, { verb: 'pulse', target: 'left' }] },
    ],
  },
  {
    id: 'moretrack',
    kind: 'clip',
    title: 'Every move on one track',
    description: 'Seven events along a single track, set above and below it by turns, with two markers, put through every verb the timeline stage takes.',
    stage: {
      kind: 'timeline',
      events: [
        { id: 'e1', when: '1879', label: 'A first pact is signed' },
        { id: 'e2', when: '1882', label: 'A third power joins it', detail: 'The pact is now three, and its neighbours take note.' },
        { id: 'e3', when: '1894', label: 'Two rivals answer with their own' },
        { id: 'e4', when: '1904', label: 'An old quarrel is settled', tone: 'accent' },
        { id: 'e5', when: '1907', label: 'The second bloc is complete' },
        { id: 'e6', when: '1912', label: 'A regional war' },
        { id: 'e7', when: '1914', label: 'The crisis' },
      ],
      markers: [{ id: 'now' }, { id: 'then', tone: 'warn' }],
      stats: [{ id: 'blocs', label: 'Blocs', value: 0 }],
      cites: [],
      provenance: 'illustrative',
    },
    beats: [
      { caption: framing('The track opens as far as the events on stage; more are shown.'), do: [{ verb: 'show', targets: ['e5', 'e6'] }, { verb: 'move', target: 'now', to: 'e2' }, { verb: 'set', target: 'blocs', value: 1, with: true }] },
      { caption: framing('A marker travels back and forward; a second one lands.'), do: [{ verb: 'move', target: 'now', to: 'e5' }, { verb: 'move', target: 'then', to: 'e1' }, { verb: 'move', target: 'now', to: 'e3' }, { verb: 'set', target: 'now', tone: 'good' }] },
      { caption: framing('One event in the spotlight shows its detail; then a range.'), do: [{ verb: 'focus', targets: ['e2'] }, { verb: 'pulse', target: 'e2', with: true }, { verb: 'focus', between: ['e3', 'e5'] }, { verb: 'focus', targets: ['e4', 'e5'], zoom: true }] },
      { caption: framing('Events take tones and new words.'), do: [{ verb: 'focus' }, { verb: 'set', target: 'e6', tone: 'warn', label: 'A regional war, twice' }, { verb: 'set', targets: ['e1', 'e3'], tone: 'muted' }, { verb: 'set', target: 'track', tone: 'accent' }] },
      { caption: framing('The last event is drawn in, and things leave.'), do: [{ verb: 'draw', target: 'track' }, { verb: 'set', target: 'e7', tone: 'bad' }, { verb: 'hide', targets: ['then', 'e4'] }, { verb: 'show', targets: ['e4', 'then'] }] },
    ],
  },
  {
    id: 'morelanes',
    kind: 'clip',
    title: 'Every move on lanes',
    description: 'Two lanes of events brought on one at a time, a span that slides from one pair of events to another, and a focus on a lane and on a span.',
    stage: {
      kind: 'timeline',
      lanes: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South', tone: 'muted' }],
      events: [
        { id: 'n1', when: 'spring', lane: 'north', label: 'Tariffs rise' },
        { id: 's1', when: 'spring', lane: 'south', label: 'Harvest fails' },
        { id: 'n2', when: 'summer', lane: 'north', label: 'Factories close' },
        { id: 's2', when: 'autumn', lane: 'south', label: 'Prices double' },
        { id: 'n3', when: 'autumn', lane: 'north', label: 'Strikes spread' },
        { id: 'both', when: 'winter', label: 'The government falls', detail: 'Both pressures arrive at once.' },
      ],
      spans: [{ id: 'build', from: 'n1', to: 'n2', label: 'pressure builds' }, { id: 'plain', from: 's1', to: 's2' }],
      markers: [{ id: 'now', label: 'now' }],
      cites: [],
      provenance: 'illustrative',
    },
    beats: [
      { caption: framing('Events are shown one lane at a time.'), do: [{ verb: 'show', targets: ['n1', 'n2', 'n3'] }, { verb: 'show', targets: ['s1', 's2'] }, { verb: 'show', targets: ['build', 'plain'] }] },
      { caption: framing('A lane in focus, then a span.'), do: [{ verb: 'focus', targets: ['south'] }, { verb: 'focus', targets: ['build'] }, { verb: 'move', target: 'build', to: ['n2', 'n3'] }, { verb: 'set', target: 'build', label: 'and breaks', tone: 'warn' }] },
      { caption: framing('The threads meet.'), do: [{ verb: 'focus' }, { verb: 'show', target: 'both' }, { verb: 'move', target: 'now', to: 'both' }, { verb: 'focus', targets: ['both'] }] },
      { caption: framing('And things leave.'), do: [{ verb: 'focus' }, { verb: 'hide', targets: ['plain', 'now', 's1'] }, { verb: 'set', target: 'north', tone: 'bad' }, { verb: 'pulse', targets: ['build', 'both'] }] },
    ],
  },
] as const;
const MORE_IDS = MORE.map((c) => c.id);

/** A lesson whose scenes are the example clips. `gates: false` leaves the predictions out, so the scrubber can reach the whole clip. */
function lesson(gates: boolean): Published {
  const published = examplePublished();
  const scenes = [...EXTRA_EXAMPLE_CLIPS.map((c) => ClipScene.parse(gates ? c : { ...c, beats: c.beats.map(({ gate: _gate, ...beat }) => beat) })), ...MORE.map((c) => ClipScene.parse(c))];
  return { ...published, lesson: { ...published.lesson, scenes } as unknown as Published['lesson'] };
}

/**
 * The static account of each stage, placed in the clip's "On stage" block, where render/clip.ts
 * puts it once it calls render/clip-kits-extra.ts itself. A clip that already carries one is left
 * alone, so this is a no-op from then on.
 */
function withStatic(html: string): string {
  let out = html;
  for (const c of [...EXTRA_EXAMPLE_CLIPS, ...MORE]) {
    const ctx = { ui: attrs({}), id: (p: string) => domId(c.id, p), own: (n: string) => internalId(c.id, n) };
    const scene = ClipScene.parse(c);
    const extra = scene.stage.kind === 'lines' ? renderLinesStage(scene.stage, ctx) : scene.stage.kind === 'timeline' ? renderTimelineStage(scene.stage, ctx) : null;
    const box = out.indexOf(`data-clip="${c.id}"`);
    const open = '<div class="lt-onstage">';
    const at = out.indexOf(open, box);
    const next = out.indexOf('data-clip="', box + 12);
    const has = out.indexOf('class="lt-xs"', box);
    if (!extra || box < 0 || at < 0 || (has > 0 && (next < 0 || has < next))) continue;
    out = out.slice(0, at + open.length) + extra.toString() + out.slice(at + open.length);
  }
  return out;
}

async function open(page: Page, testInfo: TestInfo, id: string, opts: { gates?: boolean } = {}): Promise<Watch> {
  const watch = await openLesson(page, testInfo, { published: lesson(opts.gates === true), hash: `#/${id}`, mutate: withStatic });
  await expect(box(page, id).locator('.st-view > .st-world')).toBeAttached();
  await expect(box(page, id)).not.toHaveAttribute('data-failed', 'true');
  return watch;
}
const box = (page: Page, id: string): Locator => page.locator(`.lt-clip[data-clip="${id}"]`);
const state = (page: Page, id: string): Promise<string | null> => box(page, id).getAttribute('data-state');

/**
 * Move the scrubber, as a drag does: the pointer goes down on it (which stops the clip, and the
 * opening move if that is still playing), then the value changes. Returns where the clip went.
 */
function seek(page: Page, id: string, t: number): Promise<number> {
  return page.evaluate(
    ([clip, to]) => {
      const range = document.querySelector<HTMLInputElement>(`.lt-clip[data-clip="${clip}"] .st-range`);
      if (!range) throw new Error('no scrubber');
      range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      range.value = String(to);
      range.dispatchEvent(new Event('input', { bubbles: true }));
      return Number(range.value);
    },
    [id, t] as const,
  );
}
const position = (page: Page, id: string): Promise<number> => page.evaluate((clip) => Number(document.querySelector<HTMLInputElement>(`.lt-clip[data-clip="${clip}"] .st-range`)?.value ?? -1), id);
const length = async (page: Page, id: string): Promise<number> => Number(await box(page, id).locator('.st-range').getAttribute('max'));
/** Where each beat starts, in ms, read from the scrubber's own marks. */
function beatStarts(page: Page, id: string): Promise<number[]> {
  return page.evaluate((clip) => {
    const root = document.querySelector(`.lt-clip[data-clip="${clip}"]`);
    const max = Number(root?.querySelector<HTMLInputElement>('.st-range')?.max ?? 0);
    return Array.from(root?.querySelectorAll<HTMLElement>('.st-mark') ?? []).map((m) => (parseFloat(m.style.left) / 100) * max);
  }, id);
}

/**
 * Everything the stage shows, as text: every element that is not faded out, with its class, the
 * styles the engine wrote on it, its data and geometry attributes and its own words. Two pictures
 * are the same picture exactly when these are equal.
 */
function snapshot(page: Page, id: string): Promise<string[]> {
  return page.evaluate((clip) => {
    const view = document.querySelector(`.lt-clip[data-clip="${clip}"] .st-view`);
    if (!view) throw new Error('no stage');
    const out: string[] = [];
    const walk = (el: Element): void => {
      const style = (el as HTMLElement).style;
      if (style && style.opacity === '0') return;
      const attrs = Array.from(el.attributes)
        .filter((a) => a.name.startsWith('data-') || a.name === 'd' || a.name === 'transform' || a.name === 'hidden')
        .map((a) => `${a.name}=${a.value}`)
        .join(' ');
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join('');
      out.push(`${el.tagName} .${el.getAttribute('class') ?? ''} {${style ? style.cssText : ''}} [${attrs}] "${own}"`);
      for (const child of Array.from(el.children)) walk(child);
    };
    walk(view);
    return out;
  }, id);
}

/** Parts of the two kits that are on show and reach outside the stage, left or right, while the camera is at rest. */
function overflowing(page: Page, id: string): Promise<string[]> {
  return page.evaluate((clip) => {
    const view = document.querySelector<HTMLElement>(`.lt-clip[data-clip="${clip}"] .st-view`);
    if (!view) throw new Error('no stage');
    const frame = view.getBoundingClientRect();
    // While the camera is moved in on something (a focus with `zoom`), the rest is meant to be off the edge.
    // Read the computed transform: the engine may write the camera as a matrix, not as scale().
    const world = view.querySelector<HTMLElement>('.st-world');
    const cam = world ? getComputedStyle(world).transform : 'none';
    const m = /^matrix\(([^)]+)\)$/.exec(cam);
    const atRest = cam === 'none' || (m !== null && m[1]!.split(',').map(Number).every((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]!) < 0.001));
    if (!atRest) return [];
    const shown = (el: Element): boolean => {
      for (let e: Element | null = el; e && e !== view; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 0.05) return false;
      return true;
    };
    const parts = '.st-ln .st-l, .st-ln-math, .st-ln-val, .st-ln-note, .st-ln-ptr, .st-ln-bracket, .st-ln-flag, .st-tl-card, .st-tl-dot, .st-tl-mk-ring, .st-tl-span-line, .st-tl-legend, .st-tl-lane, .st-tl-tick, .st-stat';
    return Array.from(view.querySelectorAll(parts))
      .filter(shown)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.left < frame.left - 1 || r.right > frame.right + 1))
      .map(({ el, r }) => `${el.getAttribute('class')} "${(el.textContent ?? '').slice(0, 24)}" ${Math.round(r.left - frame.left)}..${Math.round(r.right - frame.left)} of ${Math.round(frame.width)}`);
  }, id);
}

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
/**
 * axe-core over one scene. Every violation fails. A contrast axe could not decide fails when it is
 * in the static account these two stages write (.lt-xs); on the stage itself axe cannot see through
 * the field's own layers to a background, and the stage's colours are the shell's dark palette,
 * whose contrast the token test holds.
 */
async function audit(page: Page, state: string, only: string): Promise<void> {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).include(only).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    `${state}: violations`,
  ).toEqual([]);
  // Two things axe reports as undecided are not about a colour: "overlapped by another element"
  // is about where the page happened to be scrolled (the shell's pager sits over the bottom of the
  // window), and "only non-text characters" is a lone operator sign in a line of maths.
  const NOT_COLOUR = /overlapped by another element|only non-text characters/;
  const undecided = results.incomplete
    .filter((r) => r.id === 'color-contrast')
    .flatMap((r) => r.nodes)
    .filter((n) => n.target.join(' ').includes('lt-xs') && !n.any.every((check) => NOT_COLOUR.test(check.message ?? '')))
    .map((n) => `${n.target.join(' ')}: ${n.any.map((check) => check.message).join('; ')}`);
  expect(undecided, `${state}: contrast axe could not decide, in the static account`).toEqual([]);
  expect(results.passes.length, `${state}: rules that ran`).toBeGreaterThan(15);
}

/** What the end of each example must show, whatever route led there. */
const AT_THE_END: Record<string, string> = {
  trace: '.st-ln[data-tone="good"]',
  halvings: '.st-ln[data-tone="good"]',
  twenty: '.st-tl-ev[data-tone="good"][data-lit="1"]',
  squeeze: '.st-tl-ev[data-tone="good"][data-cross]',
};

test.describe('the lines and timeline kits build and play', () => {
  for (const id of IDS) {
    test(`${id}: builds, plays, pauses, and makes no request, error or violation`, async ({ page, browserName }, testInfo) => {
      const watch = await open(page, testInfo, id, { gates: true });
      expect(await state(page, id)).toBe('poster');
      await box(page, id).locator('.st-bigplay').click();
      await expect(box(page, id)).toHaveAttribute('data-state', 'playing');
      await expect.poll(() => position(page, id), { timeout: 8000 }).toBeGreaterThan(700);
      await box(page, id).locator('.st-play').click();
      await expect(box(page, id)).toHaveAttribute('data-state', 'paused');
      const at = await position(page, id);
      await page.waitForTimeout(250);
      expect(await position(page, id), 'a paused clip stays where it is').toBe(at);
      // Nothing on the stage moves by itself while the clip rests.
      const still = await snapshot(page, id);
      await page.waitForTimeout(300);
      expect(await snapshot(page, id)).toEqual(still);
      await expectClean(watch, browserName);
    });
  }
});

test.describe('the same instant is the same picture', () => {
  for (const id of [...IDS, ...MORE_IDS]) {
    test(`${id}: however it was reached`, async ({ page, browserName }, testInfo) => {
      const watch = await open(page, testInfo, id);
      const max = await length(page, id);
      expect(max).toBeGreaterThan(5000);
      const times = [0.04, 0.11, 0.19, 0.27, 0.36, 0.44, 0.53, 0.61, 0.7, 0.78, 0.87, 0.95, 1].map((f) => Math.round(f * max) - 1);
      // Route one: forwards, each instant straight after the one before.
      const direct: string[][] = [];
      for (const t of times) {
        expect(await seek(page, id, t)).toBe(t);
        direct.push(await snapshot(page, id));
      }
      expect(new Set(direct.map((s) => s.join('\n'))).size, 'the picture changes through the clip').toBeGreaterThan(6);
      // Route two: backwards, by way of the end and of another instant.
      for (let k = times.length - 1; k >= 0; k--) {
        const t = times[k] as number;
        await seek(page, id, max);
        await seek(page, id, Math.round(t * 0.37));
        await seek(page, id, t);
        expect(await snapshot(page, id), `at ${t} ms, after the end and ${Math.round(t * 0.37)} ms`).toEqual(direct[k]);
      }
      // Route three: after the clip has played for a moment from somewhere else.
      await seek(page, id, Math.round(max * 0.3));
      await box(page, id).locator('.st-play').click();
      await expect.poll(() => position(page, id), { timeout: 5000 }).toBeGreaterThan(Math.round(max * 0.3) + 200);
      await box(page, id).locator('.st-play').click();
      await expect(box(page, id)).toHaveAttribute('data-state', 'paused');
      for (const k of [2, 7, 12]) {
        await seek(page, id, times[k] as number);
        expect(await snapshot(page, id), `at ${times[k]} ms, after playing`).toEqual(direct[k]);
      }
      if (AT_THE_END[id]) await expect(box(page, id).locator(AT_THE_END[id] as string)).toHaveCount(1);
      await expectClean(watch, browserName);
    });
  }
});

test.describe('stepping', () => {
  for (const id of IDS) {
    test(`${id}: Next plays one beat and stops; again, and it stops further on`, async ({ page }, testInfo) => {
      await open(page, testInfo, id);
      const starts = await beatStarts(page, id);
      expect(starts.length).toBeGreaterThanOrEqual(4);
      // Twice the speed: the test is about where the clip stops, not how long it takes.
      await box(page, id).locator('.st-speed input[value="2"]').check({ force: true });
      const next = box(page, id).locator('.st-next');
      await next.click();
      await expect(box(page, id)).toHaveAttribute('data-state', 'paused', { timeout: 15000 });
      const first = await position(page, id);
      expect(first).toBeGreaterThan(0);
      await next.click();
      await expect.poll(() => position(page, id), { timeout: 15000 }).toBeGreaterThan(first + 200);
      await expect(box(page, id)).toHaveAttribute('data-state', 'paused', { timeout: 15000 });
      const second = await position(page, id);
      // Each stop is the end of a beat: just short of where the next one starts.
      for (const stop of [first, second]) expect(Math.min(...starts.map((s) => Math.abs(s - stop))), `stopped at ${stop}; beats start at ${starts.map(Math.round).join(', ')}`).toBeLessThan(40);
      expect(second).toBeGreaterThan(first);
    });
  }
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  for (const id of IDS) {
    test(`${id}: every instant of a beat shows the beat's end state, and Next goes straight to the next still`, async ({ page, browserName }, testInfo) => {
      const watch = await open(page, testInfo, id);
      const max = await length(page, id);
      const starts = await beatStarts(page, id);
      const ends = [...starts.slice(1), max];
      const stills: string[] = [];
      for (let i = 0; i < starts.length; i++) {
        const t0 = starts[i] as number;
        const span = (ends[i] as number) - t0;
        const pictures: string[] = [];
        for (const f of [0.08, 0.3, 0.55, 0.8, 0.97]) {
          await seek(page, id, Math.round(t0 + span * f));
          pictures.push((await snapshot(page, id)).join('\n'));
        }
        expect(new Set(pictures).size, `beat ${i + 1}: one picture for the whole beat`).toBe(1);
        stills.push(pictures[0] as string);
      }
      expect(new Set(stills).size, 'each beat has its own still').toBeGreaterThanOrEqual(starts.length - 1);
      // The last still is the end of the story.
      await seek(page, id, max);
      await expect(box(page, id).locator(AT_THE_END[id] as string)).toHaveCount(1);
      // Next does not play: it is already at the next still.
      await seek(page, id, 0);
      await box(page, id).locator('.st-next').click();
      expect(await state(page, id)).not.toBe('playing');
      const after = await position(page, id);
      expect(after).toBeGreaterThan(0);
      await page.waitForTimeout(200);
      expect(await position(page, id)).toBe(after);
      await expectClean(watch, browserName);
    });
  }
});

test.describe('at 320 pixels', () => {
  test.use({ viewport: { width: 320, height: 720 } });
  for (const id of [...IDS, ...MORE_IDS]) {
    test(`${id}: nothing scrolls the page sideways and no part leaves the stage`, async ({ page, browserName }, testInfo) => {
      const watch = await open(page, testInfo, id);
      const max = await length(page, id);
      expect(await pageWidth(page)).toBeLessThanOrEqual(320);
      for (let k = 0; k <= 16; k++) {
        await seek(page, id, Math.round((max * k) / 16));
        expect(await overflowing(page, id), `at ${Math.round((max * k) / 16)} ms`).toEqual([]);
        expect(await pageWidth(page), `at ${Math.round((max * k) / 16)} ms`).toBeLessThanOrEqual(320);
      }
      if (await box(page, id).locator('.st-tl-view').count()) await expect(box(page, id).locator('.st-tl-view')).toHaveAttribute('data-dir', 'v');
      // With the text version open, the static account fits too.
      await box(page, id).locator('details.st-about > summary').click();
      expect(await pageWidth(page), 'with the text version open').toBeLessThanOrEqual(320);
      await expectClean(watch, browserName);
    });
  }
});

test.describe('wide', () => {
  test.use({ viewport: { width: 1280, height: 860 } });
  for (const id of [...IDS, ...MORE_IDS]) {
    test(`${id}: no part leaves the stage`, async ({ page }, testInfo) => {
      await open(page, testInfo, id);
      const max = await length(page, id);
      for (let k = 0; k <= 12; k++) {
        await seek(page, id, Math.round((max * k) / 12));
        expect(await overflowing(page, id), `at ${Math.round((max * k) / 12)} ms`).toEqual([]);
      }
      if (await box(page, id).locator('.st-tl-view').count()) await expect(box(page, id).locator('.st-tl-view')).toHaveAttribute('data-dir', 'h');
    });
  }
});

test.describe('what the two stages say and do not say', () => {
  test('code is labelled as the agent\'s on the stage and in the page, keeps its whitespace, and has no copy button', async ({ page }, testInfo) => {
    await open(page, testInfo, 'trace');
    const b = box(page, 'trace');
    await expect(b.locator('.st-view .st-ln-flag')).toContainText(CODE_LABEL);
    await expect(b.locator('.lt-xs-flag')).toHaveText(CODE_LABEL);
    expect(await b.locator('.st-view button, .st-view a, .lt-xs button').count()).toBe(0);
    expect(await b.evaluate((el) => /\bcopy\b/i.test(el.textContent ?? '') || el.querySelector('[aria-label*="opy"], [title*="opy"]') !== null)).toBe(false);
    await seek(page, 'trace', (await length(page, 'trace')) - 1);
    // Line 4 as it stands on the stage: eight spaces of indentation, kept.
    const line = b.locator('.st-view .st-ln').nth(3).locator('.st-l').first();
    expect(await line.evaluate((el) => el.textContent)).toBe('        mid = low + (high - low) // 2');
    expect(await line.evaluate((el) => getComputedStyle(el).whiteSpace)).toMatch(/^pre/);
    expect(await b.locator('.lt-xs-lines code').nth(3).evaluate((el) => [el.textContent, getComputedStyle(el).whiteSpace])).toEqual(['        mid = low + (high - low) // 2', 'pre-wrap']);
  });
  test('maths on the stage is the page\'s own MathML, never its source', async ({ page }, testInfo) => {
    await open(page, testInfo, 'halvings');
    const b = box(page, 'halvings');
    await seek(page, 'halvings', (await length(page, 'halvings')) - 1);
    expect(await b.locator('.st-view .st-ln-math math').count()).toBeGreaterThanOrEqual(4);
    expect(await b.locator('.st-view').evaluate((el) => el.textContent ?? '')).not.toContain('\\frac');
    expect(await b.locator('.st-view mfrac').count()).toBeGreaterThanOrEqual(1);
  });
  test('the stage is not announced twice: it is hidden from assistive technology, and the page carries the account', async ({ page }, testInfo) => {
    await open(page, testInfo, 'twenty');
    const b = box(page, 'twenty');
    await expect(b.locator('.st-view')).toHaveAttribute('aria-hidden', 'true');
    await expect(b.locator('.lt-xs-timeline > li')).toHaveCount(6);
    await expect(b.locator('.lt-xs-timeline > li').first()).toContainText('start');
  });
});

test.describe('axe', () => {
  for (const width of [1280, 320]) {
    for (const scheme of ['light', 'dark'] as const) {
      test.describe(`${width} px, ${scheme}`, () => {
        test.use({ viewport: { width, height: 800 }, colorScheme: scheme });
        for (const id of IDS) {
          test(`${id}: at rest, at the end, and with its text version open`, async ({ page }, testInfo) => {
            await open(page, testInfo, id);
            const scene = `.lt-scene[data-scene="${id}"]`;
            await audit(page, `${id} at rest`, scene);
            await seek(page, id, await length(page, id));
            await audit(page, `${id} at the end`, scene);
            await box(page, id).locator('details.st-about > summary').click();
            await audit(page, `${id} with the text version open`, scene);
          });
        }
      });
    }
  }
});
