// Words stage: kinetic typography. Lines are laid out by CSS (they wrap and scale with the stage);
// the engine only moves and fades whole words, so the text is always real, readable text.
import { type ActionData, type Chans, type Ctx, D, E, type Part, type Rect, Stage, type StageEnv, type TapTarget, Words, bump, chans, h, registerKit, setData, setO, setT } from './kit';

interface WordsData {
  kind: 'words';
  lines: { id: string; text: string; size?: 'xl' | 'l' | 'm' }[];
}

class Line implements Part {
  readonly id: string;
  readonly kind = 'line';
  readonly el: HTMLElement;
  readonly c: Chans<'rev' | 'o' | 'dim' | 's' | 'tone' | 'dy' | 'rule'>;
  /** The line's words, and the element that holds them (the page lays it out; a tap gate asks it where it is). */
  readonly text: string;
  readonly box: HTMLElement;
  private readonly words: Words;
  private readonly rule: HTMLElement;
  private readonly tones: string[] = ['neutral'];

  constructor(d: WordsData['lines'][number], parent: Element) {
    this.id = d.id;
    this.el = parent.appendChild(h('p', `st-line st-line-${d.size ?? 'l'}`));
    const text = this.el.appendChild(h('span', 'st-line-text'));
    this.text = d.text;
    this.box = text;
    this.words = new Words(text, d.text);
    // The rule under a line that has been given a tone: it is drawn, once, as the tone arrives.
    this.rule = this.el.appendChild(h('span', 'st-line-rule'));
    this.c = chans(['rev', 'o', 'dim', 's', 'tone', 'dy', 'rule']);
    this.c.o.base = 1;
    this.c.s.base = 1;
    this.c.rev.base = this.words.total;
  }
  get total(): number {
    return this.words.total;
  }
  startHidden(): void {
    this.c.rev.base = 0;
  }
  enter(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    this.c.rev.to(0, at, 0);
    ctx.raw(this.c.rev, this.words.total, at, this.words.total * ctx.pace, E.linear);
    ctx.tw(this.c.o, 1, { at, d: 1 });
    ctx.tw(this.c.dy, 0, { at, d: 1 });
  }
  exit(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    ctx.tw(this.c.o, 0, { at, d: D.exit, e: E.exit });
    ctx.tw(this.c.dy, -14, { at, d: D.exit, e: E.exit });
    this.c.rev.to(0, at + D.exit * ctx.pace, 0);
  }
  pulse(ctx: Ctx, delay = 0): void {
    ctx.tw(this.c.s, 1, { at: ctx.t + delay, d: D.pop, e: E.linear, fn: bump(0.05) });
  }
  setTone(ctx: Ctx, tone: string, delay = 0): void {
    if (this.tones[this.tones.length - 1] === tone) return;
    this.tones.push(tone);
    const at = ctx.t + delay;
    this.c.tone.to(this.tones.length - 1, at + 100 * ctx.pace, 0);
    this.c.rule.to(0, at, 0);
    ctx.tw(this.c.rule, tone === 'neutral' ? 0 : 1, { at: at + 60 * ctx.pace, d: D.draw * 1.3, e: E.enter });
    this.pulse(ctx, delay);
  }
  rest(): Rect {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  apply(t: number): void {
    const c = this.c;
    setO(this.el, c.o.at(t) * (1 - 0.74 * c.dim.at(t)));
    setT(this.el, 0, c.dy.at(t), c.s.at(t));
    this.words.apply(c.rev.at(t), 18);
    setData(this.el, 'tone', this.tones[Math.round(c.tone.at(t))] as string);
    const r = c.rule.at(t);
    setO(this.rule, r > 0.002 ? 1 : 0);
    setT(this.rule, 0, 0, r, 0, 1);
  }
}

export class WordsStage extends Stage<WordsData> {
  private readonly lines: Line[];
  constructor(data: WordsData, env: StageEnv) {
    super(data, env);
    const col = this.world.appendChild(h('div', 'st-lines'));
    this.lines = data.lines.map((l) => this.add(new Line(l, col)));
  }
  override intro(ctx: Ctx): void {
    let delay = 0;
    for (const l of this.lines) {
      if (l.c.rev.base <= 0) continue;
      l.startHidden();
      l.enter(ctx, delay);
      delay += (l.total * 0.6 + 140) * ctx.pace;
    }
  }
  /** show: each line is revealed after the one before it has mostly arrived. */
  override show(ctx: Ctx, a: ActionData): void {
    let delay = 0;
    for (const id of this.ids(a)) {
      const l = this.get(id);
      if (!(l instanceof Line)) throw new Error(`show: "${id}" is not a line on this words stage.`);
      l.enter(ctx, delay);
      delay += (l.total * 0.7 + 120) * ctx.pace;
    }
  }
  /** Lines are laid out by the page, so a line that has been shown is wherever the page put it. */
  override taps(t: number): TapTarget[] {
    const out: TapTarget[] = [];
    const stage = this.el as Partial<HTMLElement>;
    if (typeof stage.getBoundingClientRect !== 'function') return out;
    const origin = stage.getBoundingClientRect();
    for (const l of this.lines) {
      if (l.c.rev.at(t) <= 0 || l.c.o.at(t) < 0.5) continue;
      const r = l.box.getBoundingClientRect();
      if (r.width < 1) continue;
      out.push({ id: l.id, label: l.text, x: Math.round(r.left - origin.left - 8), y: Math.round(r.top - origin.top - 4), w: Math.round(r.width + 16), h: Math.round(Math.max(32, r.height + 8)) });
    }
    return out;
  }
  /** A words stage has no camera to move: the lines are laid out by the page, not placed. */
  override focus(ctx: Ctx, a: ActionData): void {
    super.focus(ctx, { ...a, zoom: false });
  }
}

registerKit('words', (data: WordsData, env) => new WordsStage(data, env));
