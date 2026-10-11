// The escaping module is the security boundary of the renderer, so its rules are pinned one by one.
import { describe, expect, it } from 'vitest';
import {
  Html, attrs, domId, esc, html, idLink, inlineScriptText, inlineStyleText, internalId, isBase64, jsonForScript, pageId, raw, sceneHeadingId, sourceLink, textDirective, token,
} from '../../src/render/escape';
import { renderInline, renderMath } from '../../src/render/inline';
import { scan } from './helpers';

const NUL = String.fromCharCode(0);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

describe('esc', () => {
  it.each([
    ['plain', 'plain'],
    ['a & b', 'a &amp; b'],
    ['<b>', '&lt;b&gt;'],
    ['"q"', '&quot;q&quot;'],
    ["it's", 'it&#39;s'],
    ['&amp;', '&amp;amp;'],
    [`a${NUL}b`, `a${String.fromCharCode(0xfffd)}b`],
  ])('%j', (input, expected) => expect(esc(input)).toBe(expected));
  it('formats numbers as text', () => expect(esc(3.5)).toBe('3.5'));
});

describe('html', () => {
  it('escapes interpolated strings in content and in attribute values', () => {
    const evil = '"><script>x</script>';
    const out = html`<p title="${evil}">${evil}</p>`.toString();
    expect(out).toBe('<p title="&quot;&gt;&lt;script&gt;x&lt;/script&gt;">&quot;&gt;&lt;script&gt;x&lt;/script&gt;</p>');
    const s = scan(out);
    expect(s.tags.map((t) => t.name)).toEqual(['p', 'p']);
    expect(s.tags[0]?.attrs.get('title')).toBe(evil);
    expect(s.text).toBe(evil);
  });

  it('inserts Html values as they are and joins arrays', () => {
    const inner = html`<em>${'a<b'}</em>`;
    expect(html`<p>${inner}${[inner, 'x<y', 2, null, undefined, false]}</p>`.toString()).toBe('<p><em>a&lt;b</em><em>a&lt;b</em>x&lt;y2</p>');
  });

  it('returns an Html value, so nesting never escapes twice', () => {
    expect(html`<b>${html`<i>${'&'}</i>`}</b>`).toBeInstanceOf(Html);
    expect(html`<b>${html`<i>${'&'}</i>`}</b>`.toString()).toBe('<b><i>&amp;</i></b>');
  });

  it.each([
    ['a tag name', () => html`<${'div'}>x</div>`],
    ['an attribute name', () => html`<p ${'hidden'}>x</p>`],
    ['an unquoted attribute value', () => html`<p title=${'x'}>x</p>`],
    ['a single-quoted attribute value', () => html`<p title='${'x'}'>x</p>`],
    ['a style attribute', () => html`<p style="${'color:red'}">x</p>`],
    ['a static style attribute', () => html`<p style="color:red">${'x'}</p>`],
    ['an event handler', () => html`<p onclick="${'x'}">x</p>`],
    ['a static event handler', () => html`<button onclick="go()">${'x'}</button>`],
    ['a script element', () => html`<script>${'x'}</script>`],
    ['a style element', () => html`<style>${'x'}</style>`],
    ['a comment', () => html`<!-- ${'x'} -->`],
    ['a stray less-than sign', () => html`<p>a < ${'b'}</p>`],
    ['markup inside an attribute', () => html`<p title="${html`<b>x</b>`}">x</p>`],
    ['a list inside an attribute', () => html`<p title="${['a', 'b']}">x</p>`],
    ['a plain string as a class', () => html`<p class="a ${'b'}">x</p>`],
    ['a plain string as an href', () => html`<a href="${'https://example.org/'}">x</a>`],
    ['a Url that is only part of an href', () => html`<a href="${idLink('lt-main')}x">x</a>`],
    ['a Url as content', () => html`<p>${idLink('lt-main')}</p>`],
    ['a string in the tag position', () => html`<p${' hidden'}>x</p>`],
    ['a template that ends inside a tag', () => html`<p title="${'x'}"`],
  ])('refuses %s', (_name, build) => expect(build).toThrow(/render\/escape/));

  it('accepts a Url as a whole href and a Token in a class', () => {
    expect(html`<a class="lt-x ${token('b', ['a', 'b'], 'a', 'lt-')}" href="${idLink('lt-main')}">x</a>`.toString()).toBe('<a class="lt-x lt-b" href="#lt-main">x</a>');
  });
});

describe('attrs and token', () => {
  it('writes values escaped, booleans bare, and nothing for absent ones', () => {
    expect(html`<p${attrs({ lang: 'pt-BR', hidden: true, title: 'a"b', 'data-x': 3, role: undefined, dir: null, open: false })}>x</p>`.toString()).toBe(
      '<p lang="pt-BR" hidden title="a&quot;b" data-x="3">x</p>',
    );
  });
  it.each(['style', 'onclick', 'onload', 'Data-X', 'a b', 'x"y', 'href'])('refuses the attribute %j as a plain value', (name) => {
    expect(() => attrs({ [name]: 'v' })).toThrow(/render\/escape/);
  });
  it('lets a lesson value choose among fixed class names and nothing else', () => {
    expect(token('step_through', ['narration', 'step_through'], 'narration', 'lt-kind-').value).toBe('lt-kind-step_through');
    expect(token('x" onload="y', ['narration'], 'narration', 'lt-kind-').value).toBe('lt-kind-narration');
    expect(() => token('a', ['a b'] as const, 'a b')).toThrow(/render\/escape/);
  });
});

describe('ids', () => {
  it('follows the documented shapes', () => {
    expect(domId('s2', 'syn-ack')).toBe('lt-s2-syn-ack');
    expect(internalId('s2', 'src3')).toBe('lt-s2-_src3');
    expect(sceneHeadingId('s2')).toBe('scene-s2');
    expect(pageId('data')).toBe('lt-data');
    expect(pageId('source', 4)).toBe('lt-source-_4');
  });

  it('never produces the same id for two different things', () => {
    // Scene and part ids that would collide if they were simply joined with dashes, plus names the page itself uses.
    const ids = ['a', 'a-b', 'a--b', 'b', 'b-c', 'c', 'a-', 'a-b-c', 'data', 'main', 'sources', 'scene', 'scene-a', 'lt', 'lt-a', 'x', 'title', 'l1', 's1', 'src1', 'source', 'a_', '_'].filter((id) =>
      /^[a-z][a-z0-9_-]{0,31}$/.test(id),
    );
    const seen = new Map<string, string>();
    const claim = (id: string, what: string): void => {
      expect(seen.get(id), `${id} is both ${seen.get(id)} and ${what}`).toBeUndefined();
      seen.set(id, what);
    };
    for (const scene of ids) {
      claim(sceneHeadingId(scene), `heading(${scene})`);
      claim(internalId(scene, 'scene'), `section(${scene})`);
      for (const name of ['src1', 'src1-h', 'figure', 'summary', 'next1']) claim(internalId(scene, name), `internal(${scene},${name})`);
      for (const part of ids) claim(domId(scene, part), `part(${scene},${part})`);
    }
    for (const name of ['data', 'main', 'sources', 'title', 'live', 'audio', 'contents', 'pager', 'back', 'next', 'theme', 'receipt', 'scene', 'source']) claim(pageId(name), `page(${name})`);
    for (let n = 1; n <= 3; n++) claim(pageId('source', n), `page(source,${n})`);
  });

  it('flattens anything that is not an id, so a DOM id is always plain', () => {
    for (const bad of ['"><script>', 'A B', '', '../x', '__proto__', 'x'.repeat(200)]) {
      expect(domId(bad, bad)).toMatch(/^lt-[a-z0-9_-]+$/);
      expect(sceneHeadingId(bad)).toMatch(/^scene-[a-z0-9_-]+$/);
      expect(internalId(bad, 'x')).toMatch(/^lt-[a-z0-9_-]+$/);
    }
  });

  it('only links to renderer-generated ids', () => {
    expect(idLink(sceneHeadingId('s1')).href).toBe('#scene-s1');
    for (const bad of ['javascript:alert(1)', 'x', 'lt-a b', 'lt-"', '']) expect(() => idLink(bad)).toThrow(/render\/escape/);
  });
});

describe('sourceLink', () => {
  const excerpt = 'Binary search finds a target value in a sorted array by repeatedly comparing the target with the middle element.';

  it('rebuilds the address from the parser and adds a text directive', () => {
    const link = sourceLink({ url: 'https://Example.ORG:443/a b/../c?q=1#old', excerpt });
    expect(link?.host).toBe('example.org');
    expect(link?.shown).toBe('https://example.org/c?q=1');
    expect(link?.url.href).toBe('https://example.org/c?q=1#:~:text=Binary%20search%20finds%20a%20target,target%20with%20the%20middle%20element.');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.org/x',
    'blob:https://example.org/1',
    'vbscript:x',
    ' javascript:alert(1)',
    'https://user:pass@example.org/',
    'https://user@example.org/',
    'not a url',
    '//example.org/x',
    '',
  ])('refuses %j', (url) => expect(sourceLink({ url, excerpt })).toBeNull());

  it('shows the punycode host of an internationalised name', () => {
    expect(sourceLink({ url: 'https://exämple.org/', excerpt })?.host).toBe('xn--exmple-cua.org');
  });

  it('percent-encodes everything a text directive treats as syntax', () => {
    expect(textDirective('a-b, c & d')).toBe('text=a%2Db%2C%20c%20%26%20d');
    const d = textDirective('one-two three, four & five six seven eight nine ten eleven twelve');
    expect(d).toBe('text=one%2Dtwo%20three%2C%20four%20%26%20five,eight%20nine%20ten%20eleven%20twelve');
    expect(d).not.toMatch(/[-&]/);
    expect(d.split(',')).toHaveLength(2);
  });

  // Review findings M2 and P6. A browser matches a piece only where it begins and ends on a word
  // boundary, so a piece cut by counting characters opened the source at the top with nothing
  // marked. test/player/shell-passage.spec.ts follows these same links in real browsers.
  const pieces = (passage: string, lang?: string): string[] =>
    textDirective(passage, lang)
      .slice('text='.length)
      .split(',')
      .map((p) => decodeURIComponent(p));
  const boundaries = (text: string, lang: string): Set<number> => {
    const at = new Set<number>([0]);
    let n = 0;
    for (const seg of new Intl.Segmenter(lang, { granularity: 'word' }).segment(text)) at.add((n += seg.segment.length));
    return at;
  };

  it('takes whole words from each end, however long a word is', () => {
    const cases: [string, string, string][] = [
      [
        'Bundesausbildungsförderungsgesetz Rechtsschutzversicherungsgesellschaften Donaudampfschifffahrtsgesellschaft Kraftfahrzeughaftpflichtversicherung Arbeitsunfähigkeitsbescheinigung regeln die Ansprüche der Studierenden in Deutschland seit vielen Jahren.',
        'Bundesausbildungsförderungsgesetz',
        'in Deutschland seit vielen Jahren.',
      ],
      [
        'The compounds studied in this work were pyridoxal-5-phosphate, methylenetetrahydrofolate, phosphoribosylpyrophosphate, adenosylmethionine, tetrahydrobiopterin and nicotinamide-adenine-dinucleotide.',
        'The compounds studied in this',
        'tetrahydrobiopterin and nicotinamide-adenine-dinucleotide.',
      ],
      [
        'Das Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz war ein Gesetz des Landes Mecklenburg-Vorpommern und gilt als eines der längsten Wörter der deutschen Sprache.',
        'Das Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz',
        'längsten Wörter der deutschen Sprache.',
      ],
      [
        'itertools.zip_longest(*iterables, fillvalue=None) collections.abc.MutableSequence functools.partialmethod contextlib.AbstractAsyncContextManager are documented in the standard library reference for each release.',
        'itertools.zip_longest(*iterables, fillvalue=None)',
        'library reference for each release.',
      ],
    ];
    for (const [passage, first, last] of cases) expect(pieces(passage, 'de')).toEqual([first, last]);
  });

  it('does not anchor on a piece too short to find the passage by', () => {
    // "Call" alone is on any page many times; the long name after it does not fit in sixty characters, and is taken all the same.
    const [first, last] = pieces('Call AbstractSingletonProxyFactoryBean.getObjectFromFactoryBean(), then TransactionAwarePersistenceManagerFactoryProxy.setTargetPersistenceManagerFactory(), and finally release the handle so that the pool can reuse it.');
    expect(first).toBe('Call AbstractSingletonProxyFactoryBean.getObjectFromFactoryBean(),');
    expect(last).toBe('the pool can reuse it.');
    // Five very short words say too little, so more are taken while they fit.
    expect(pieces('a b c d e f g h i j k l m n o p q r s t u v w x y z and so on to the end of this passage')[0]).toBe('a b c d e f g');
  });

  it.each([
    ['ja', '二分探索は、ソート済みの配列の中央の要素と目的の値を比較し、目的の値が含まれない半分を捨てることを繰り返して、目的の値を見つけるアルゴリズムです。配列が大きくなっても比較回数はほとんど増えません。線形探索では要素数に比例して比較回数が増えますが、二分探索では対数的にしか増えないため、大規模なデータに対して非常に効率的です。'],
    ['ja', '光合成は、植物や藻類などが光エネルギーを化学エネルギーに変換する生化学反応である。葉緑体の中で二酸化炭素と水から糖が合成され、その過程で酸素が放出される。この反応は地球上のほぼすべての生命を支えるエネルギーの源であり、大気中の酸素濃度を維持する役割も果たしている。'],
    ['ja', '江戸時代は、徳川家康が征夷大将軍に任命された1603年から大政奉還までの約二百六十年間を指す。この時代には幕藩体制が確立し、鎖国政策のもとで独自の文化が発展した。商人や町人の経済力が高まり、歌舞伎や浮世絵などの町人文化が花開いたことでも知られている。'],
    ['zh', '二分查找是一种在有序数组中查找某一特定元素的搜索算法。搜索过程从数组的中间元素开始，如果中间元素正好是要查找的元素，则搜索过程结束；如果某一特定元素大于或者小于中间元素，则在数组大于或小于中间元素的那一半中查找，而且跟开始一样从中间元素开始比较。如果在某一步骤数组为空，则代表找不到。这种搜索算法每一次比较都使搜索范围缩小一半。'],
    ['zh', '光合作用是植物、藻类和某些细菌利用光能把二氧化碳和水转化为有机物并释放氧气的过程。这个过程主要发生在叶绿体中，分为光反应和暗反应两个阶段。光反应把光能转化为活跃的化学能，暗反应则利用这些能量把二氧化碳固定为糖类。地球上几乎所有生命都直接或间接依赖光合作用提供的能量。'],
    ['th', 'การค้นหาแบบทวิภาคเป็นขั้นตอนวิธีการค้นหาที่หาตำแหน่งของค่าเป้าหมายภายในแถวลำดับที่เรียงลำดับแล้วโดยเปรียบเทียบค่าเป้าหมายกับสมาชิกตรงกลางของแถวลำดับถ้าไม่เท่ากันครึ่งที่ค่าเป้าหมายไม่สามารถอยู่ได้จะถูกตัดออกและการค้นหาจะดำเนินต่อไปในครึ่งที่เหลือ'],
    ['th', 'ประเทศไทยตั้งอยู่ในภูมิภาคเอเชียตะวันออกเฉียงใต้มีพรมแดนติดกับประเทศพม่าลาวกัมพูชาและมาเลเซียมีกรุงเทพมหานครเป็นเมืองหลวงและเป็นศูนย์กลางการบริหารราชการแผ่นดินรวมทั้งเป็นเมืองที่มีประชากรมากที่สุดของประเทศ'],
  ])('ends each piece of a long %s passage on a word boundary, never inside a word', (lang, passage) => {
    const [first, last] = pieces(passage, lang) as [string, string];
    expect(passage.startsWith(first)).toBe(true);
    expect(passage.endsWith(last)).toBe(true);
    expect(first.length + last.length).toBeLessThan(passage.length);
    const at = boundaries(passage, lang);
    expect(at.has(first.length), `"${first}" ends inside a word`).toBe(true);
    expect(at.has(passage.length - last.length), `"${last}" begins inside a word`).toBe(true);
    // Short enough to be one stretch of one paragraph, and long enough to be worth looking for.
    for (const piece of [first, last]) {
      expect(Array.from(piece).length).toBeLessThanOrEqual(40);
      expect(Array.from(piece).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('stops before punctuation where it can, which every browser agrees is a boundary', () => {
    const passage =
      '二分探索は、ソート済みの配列の中央の要素と目的の値を比較し、目的の値が含まれない半分を捨てることを繰り返して、目的の値を見つけるアルゴリズムです。配列が大きくなっても比較回数はほとんど増えません。線形探索では要素数に比例して比較回数が増えますが、二分探索では対数的にしか増えないため、大規模なデータに対して非常に効率的です。';
    expect(pieces(passage, 'ja')).toEqual(['二分探索は、ソート済みの配列の中央の要素と目的の値を比較し', '大規模なデータに対して非常に効率的です。']);
    // The old cut, for comparison: twenty-four characters from each end, wherever that fell.
    expect(pieces(passage, 'ja')[0]).not.toBe(Array.from(passage).slice(0, 24).join(''));
  });

  it('gives the same link whatever language it is told, or told nothing, and survives a tag that is not one', () => {
    const passage = '光合成は、植物や藻類などが光エネルギーを化学エネルギーに変換する生化学反応である。葉緑体の中で二酸化炭素と水から糖が合成され、その過程で酸素が放出される。この反応は地球上のほぼすべての生命を支えるエネルギーの源である。';
    const told = textDirective(passage, 'ja');
    for (const lang of [undefined, 'en', 'x', '"><script>', '']) expect(textDirective(passage, lang)).toBe(told);
    expect(sourceLink({ url: 'https://example.org/', excerpt: passage, lang: 'ja' })?.url.href).toBe(`https://example.org/#:~:${told}`);
    expect(sourceLink({ url: 'https://example.org/', excerpt: passage }, 'ja')?.url.href).toBe(`https://example.org/#:~:${told}`);
  });

  it('uses the whole passage where the two pieces would meet, and nothing for an empty one', () => {
    const run = 'a'.repeat(130);
    expect(textDirective(run)).toBe(`text=${run}`);
    expect(textDirective(`${'a'.repeat(70)} ${'b'.repeat(70)}`)).toBe(`text=${'a'.repeat(70)},${'b'.repeat(70)}`);
    expect(textDirective('   ')).toBe('');
    expect(textDirective('')).toBe('');
  });

  it('is quick on the longest excerpt the format allows', () => {
    const started = Date.now();
    for (let i = 0; i < 200; i++) textDirective('二分探索は'.repeat(160), 'ja');
    for (let i = 0; i < 200; i++) textDirective(`${'x'.repeat(799)}.`, 'en');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('never lets the excerpt add a second directive or leave the fragment', () => {
    const link = sourceLink({ url: 'https://example.org/', excerpt: 'x&text=y,-z #frag "quote" <tag> end of the passage with more words here' });
    const fragment = link?.url.href.split('#')[1] ?? '';
    expect(fragment.startsWith(':~:text=')).toBe(true);
    expect(fragment.slice(':~:text='.length)).toMatch(/^[A-Za-z0-9%._,]*$/);
    expect(fragment.split(',')).toHaveLength(2);
  });
});

describe('script and style text', () => {
  it('embeds JSON that cannot end its element and reads back unchanged', () => {
    const value = { a: '</script><script>alert(1)</script>', b: '<!-- & -->', c: `x${LS}y${PS}z`, d: ['>', '&amp;'] };
    const text = jsonForScript(value);
    expect(text).not.toMatch(/[<>&]/);
    expect(text.includes(LS) || text.includes(PS)).toBe(false);
    expect(JSON.parse(text)).toEqual(value);
    const s = scan(`<script type="application/json" id="lt-data">${text}</script><p>after</p>`);
    expect(s.tags.map((t) => t.name)).toEqual(['script', 'script', 'p', 'p']);
  });

  it('keeps an inline script and style from being closed from inside', () => {
    expect(inlineScriptText('var a="</script>";var b="</SCRIPT x";var c="<!--";')).toBe('var a="<\\/script>";var b="<\\/SCRIPT x";var c="<\\!--";');
    expect(inlineStyleText('a::after{content:"</style>"}')).toBe('a::after{content:"<\\/style>"}');
  });

  it.each([
    ['QUJD', true],
    ['QUI=', true],
    ['QQ==', true],
    ['', false],
    ['QUJ', false],
    ['QUJD<', false],
    ['QU JD', false],
    ['</script>', false],
    ['QQ=A', false],
  ])('isBase64(%j) is %s', (input, expected) => expect(isBase64(input)).toBe(expected));
});

describe('inline markup', () => {
  it('maps the four inline forms to four elements and escapes the rest', () => {
    expect(renderInline('**bold** and *em* and `a<b` and <i>').toString()).toBe('<strong>bold</strong> and <em>em</em> and <code>a&lt;b</code> and &lt;i&gt;');
  });
  it('renders math as MathML and nothing else', () => {
    const out = renderInline('cost $\\log_2 n$ steps').toString();
    const tags = new Set(scan(out).tags.map((t) => t.name));
    expect(tags.has('math')).toBe(true);
    for (const name of tags) expect(name).toMatch(/^m[a-z]+$/);
    expect(out.startsWith('cost <math display="inline">')).toBe(true);
  });
  it('leaves a math span it cannot parse as the text that was typed', () => {
    expect(renderInline('$\\unknown{x}$').toString()).toBe('$\\unknown{x}$');
    expect(renderMath('\\unknown{<b>}', true).toString()).toBe('<code>\\unknown{&lt;b&gt;}</code>');
  });
  it('treats markup characters in text as text', () => {
    expect(scan(renderInline('<img src=x onerror=alert(1)> **<script>x</script>**').toString()).tags.map((t) => t.name)).toEqual(['strong', 'strong']);
  });
  it('wraps a raw string only when asked to', () => {
    expect(raw('<b>x</b>').toString()).toBe('<b>x</b>');
  });
});
