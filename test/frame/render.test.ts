// The static frame: what a frame stage is in the published file before any script runs.
import { describe, expect, it } from 'vitest';
import { FrameStage } from '../../src/core/frame';
import { FRAME_EXAMPLE_PROJECTILE, FRAME_EXAMPLES } from '../../src/core/frame-examples';
import { FRAME_TEXT } from '../../src/player/frame/shared';
import { attrs, internalId } from '../../src/render/escape';
import { FRAME_LABEL, renderFrameStage } from '../../src/render/frame';

const ctx = (sceneId: string, lang?: string) => ({ own: (name: string) => internalId(sceneId, name), ui: attrs({ lang }) });
const stage = FRAME_EXAMPLE_PROJECTILE.stage;

describe('renderFrameStage', () => {
  const html = renderFrameStage(stage, ctx('launch-angle'), { description: FRAME_EXAMPLE_PROJECTILE.description, label: FRAME_EXAMPLE_PROJECTILE.title });

  it('is the box, the description as the text alternative, the status region and the label', () => {
    expect(html).toBe(
      '<div class="lt-frame" data-frame data-state="static" data-aspect="16:9" data-duration="5" data-poster="2.2" data-label="Launch angle and range">' +
        `<div class="lt-frame-stage"><p class="lt-frame-alt" id="lt-launch--angle-_frame-alt">${FRAME_EXAMPLE_PROJECTILE.description}</p></div>` +
        '<p class="lt-frame-status" role="status"></p>' +
        '<p class="lt-frame-label">This animation was written by your agent and is not checked by Learning Tool.</p></div>',
    );
    expect(FRAME_LABEL).toBe(FRAME_TEXT.label);
  });

  it('carries no script, no style, no handler, no control and none of the code', () => {
    for (const example of FRAME_EXAMPLES) {
      const out = renderFrameStage(example.stage, ctx(example.id), { description: example.description, label: example.title });
      expect(out).not.toMatch(/<script|<style|\sstyle=|\son[a-z]+=|<canvas|<input|<button|<iframe|<img|javascript:/i);
      expect(out).not.toContain('function render');
      expect(out).not.toContain(example.stage.code.slice(0, 40));
    }
  });

  it('escapes everything that comes from the lesson', () => {
    const hostile = '"><script>alert(1)</script><img src=x onerror=alert(2)> & \' </p>';
    const out = renderFrameStage(stage, ctx('s1'), { description: hostile, label: hostile });
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<img');
    expect(out).toContain('data-label="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(2)&gt; &amp; &#39; &lt;/p&gt;"');
    expect(out).toContain('>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    // Still exactly the same elements.
    expect(out.match(/<[a-z]+/g)).toEqual(['<div', '<div', '<p', '<p', '<p']);
  });

  it('writes the aspect and the times as data, for the stylesheet and for a reader of the page', () => {
    for (const aspect of ['16:9', '4:3', '1:1'] as const) {
      const out = renderFrameStage(FrameStage.parse({ ...stage, aspect, duration: 12.5, poster: 0 }), ctx('s1'), { description: 'd'.repeat(40), label: 'A title' });
      expect(out).toContain(`data-aspect="${aspect}" data-duration="12.5" data-poster="0"`);
    }
  });

  it('marks its own words as English in a lesson written in another language', () => {
    const out = renderFrameStage(stage, ctx('s1', 'en'), { description: 'Une balle est lancée à 22 mètres par seconde.', label: 'Angle de tir' });
    expect(out).toContain('<p class="lt-frame-status" role="status" lang="en"></p>');
    expect(out).toContain('<p class="lt-frame-label" lang="en">');
    expect(out).toContain('<p class="lt-frame-alt" id="lt-s1-_frame-alt">Une balle');
  });
});
