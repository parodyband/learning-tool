// "Open the source at this passage" must land on the passage. The link is the page's one answer
// to its known limit (it cannot tell whether an excerpt is genuine), so this spec follows the
// lesson's own links in a real browser, to a stand-in for each source with the passage far down
// the page, and looks at where the browser ended up.
//
// Review findings M2 and P6: a browser matches a text directive only where each of its two pieces
// begins and ends on a word boundary. The pieces used to be cut by counting characters, so an
// excerpt with a long word at either end, and most Japanese, Chinese and Thai excerpts of more
// than 120 characters, opened the source at the top with nothing marked.
//
// Each language has more than one excerpt on purpose: a single case can pass by luck, when the
// cut happens to fall between two words.
import type { Evidence } from '../../src/core/schema';
import { renderLesson } from '../../src/render/index';
import { elements, scan } from '../render/helpers';
import { examplePublished } from '../helpers/example';
import { expect, test } from './shell-kit';

interface Case {
  name: string;
  lang: string;
  excerpt: string;
}

const CASES: Case[] = [
  { name: 'ordinary English', lang: 'en', excerpt: 'Binary search finds a target value in a sorted array by repeatedly comparing the target with the middle element and discarding the half that cannot contain it.' },
  {
    name: 'German, long compounds first',
    lang: 'de',
    excerpt:
      'Bundesausbildungsförderungsgesetz Rechtsschutzversicherungsgesellschaften Donaudampfschifffahrtsgesellschaft Kraftfahrzeughaftpflichtversicherung Arbeitsunfähigkeitsbescheinigung regeln die Ansprüche der Studierenden in Deutschland seit vielen Jahren.',
  },
  {
    name: 'German, a 63-letter word second',
    lang: 'de',
    excerpt: 'Das Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz war ein Gesetz des Landes Mecklenburg-Vorpommern und gilt als eines der längsten Wörter der deutschen Sprache.',
  },
  {
    name: 'chemical names last',
    lang: 'en',
    excerpt: 'The compounds studied in this work were pyridoxal-5-phosphate, methylenetetrahydrofolate, phosphoribosylpyrophosphate, adenosylmethionine, tetrahydrobiopterin and nicotinamide-adenine-dinucleotide.',
  },
  {
    name: 'identifiers first',
    lang: 'en',
    excerpt:
      'Call AbstractSingletonProxyFactoryBean.getObjectFromFactoryBean(), then TransactionAwarePersistenceManagerFactoryProxy.setTargetPersistenceManagerFactory(), and finally release the handle so that the pool can reuse it.',
  },
  {
    name: 'library reference',
    lang: 'en',
    excerpt:
      'itertools.zip_longest(*iterables, fillvalue=None) collections.abc.MutableSequence functools.partialmethod contextlib.AbstractAsyncContextManager are documented in the standard library reference for each release.',
  },
  {
    name: 'Japanese 1',
    lang: 'ja',
    excerpt:
      '二分探索は、ソート済みの配列の中央の要素と目的の値を比較し、目的の値が含まれない半分を捨てることを繰り返して、目的の値を見つけるアルゴリズムです。配列が大きくなっても比較回数はほとんど増えません。線形探索では要素数に比例して比較回数が増えますが、二分探索では対数的にしか増えないため、大規模なデータに対して非常に効率的です。',
  },
  {
    name: 'Japanese 2',
    lang: 'ja',
    excerpt:
      '光合成は、植物や藻類などが光エネルギーを化学エネルギーに変換する生化学反応である。葉緑体の中で二酸化炭素と水から糖が合成され、その過程で酸素が放出される。この反応は地球上のほぼすべての生命を支えるエネルギーの源であり、大気中の酸素濃度を維持する役割も果たしている。',
  },
  {
    name: 'Japanese 3, with digits',
    lang: 'ja',
    excerpt:
      '江戸時代は、徳川家康が征夷大将軍に任命された1603年から大政奉還までの約二百六十年間を指す。この時代には幕藩体制が確立し、鎖国政策のもとで独自の文化が発展した。商人や町人の経済力が高まり、歌舞伎や浮世絵などの町人文化が花開いたことでも知られている。',
  },
  {
    name: 'Chinese 1',
    lang: 'zh',
    excerpt:
      '二分查找是一种在有序数组中查找某一特定元素的搜索算法。搜索过程从数组的中间元素开始，如果中间元素正好是要查找的元素，则搜索过程结束；如果某一特定元素大于或者小于中间元素，则在数组大于或小于中间元素的那一半中查找，而且跟开始一样从中间元素开始比较。如果在某一步骤数组为空，则代表找不到。这种搜索算法每一次比较都使搜索范围缩小一半。',
  },
  {
    name: 'Chinese 2',
    lang: 'zh',
    excerpt:
      '光合作用是植物、藻类和某些细菌利用光能把二氧化碳和水转化为有机物并释放氧气的过程。这个过程主要发生在叶绿体中，分为光反应和暗反应两个阶段。光反应把光能转化为活跃的化学能，暗反应则利用这些能量把二氧化碳固定为糖类。地球上几乎所有生命都直接或间接依赖光合作用提供的能量。',
  },
  {
    name: 'Thai 1, no spaces at all',
    lang: 'th',
    excerpt:
      'การค้นหาแบบทวิภาคเป็นขั้นตอนวิธีการค้นหาที่หาตำแหน่งของค่าเป้าหมายภายในแถวลำดับที่เรียงลำดับแล้วโดยเปรียบเทียบค่าเป้าหมายกับสมาชิกตรงกลางของแถวลำดับถ้าไม่เท่ากันครึ่งที่ค่าเป้าหมายไม่สามารถอยู่ได้จะถูกตัดออกและการค้นหาจะดำเนินต่อไปในครึ่งที่เหลือ',
  },
  {
    name: 'Thai 2, phrases set apart by spaces',
    lang: 'th',
    excerpt:
      'ประเทศไทยตั้งอยู่ในภูมิภาคเอเชียตะวันออกเฉียงใต้มีพรมแดนติดกับประเทศพม่า ลาว กัมพูชา และมาเลเซียมีกรุงเทพมหานครเป็นเมืองหลวงและเป็นศูนย์กลางการบริหารราชการแผ่นดินรวมทั้งเป็นเมืองที่มีประชากรมากที่สุดของประเทศ',
  },
];

const HOST = 'https://sources.test';

/** The example lesson with these passages as its sources. The first five keep the ids the example's scenes cite. */
function lessonWithSources(): { evidence: Evidence[]; links: string[] } {
  const published = examplePublished();
  const evidence: Evidence[] = CASES.map((c, i) => ({
    id: `e${i + 1}`,
    url: `${HOST}/page-${i + 1}`,
    title: c.name,
    excerpt: c.excerpt,
    via: 'page',
    lang: c.lang,
    host: 'sources.test',
    savedOn: '2026-10-10',
  }));
  published.lesson.evidence = evidence;
  const html = renderLesson(published).html;
  const dialog = html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'));
  const links = elements(scan(dialog), 'a').map((a) => a.attrs.get('href') ?? '');
  return { evidence, links };
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** A stand-in for the source: the passage as one paragraph, a long way down a page of other text in the same language. */
function sourcePage(c: Case): string {
  const filler = Array.from({ length: 150 }, (_, i) => `<p>${c.lang === 'en' || c.lang === 'de' ? `Paragraph ${i} of something else entirely.` : `${i} 。 別の段落 另一段 อีกย่อหน้าหนึ่ง`}</p>`).join('');
  return `<!doctype html><html lang="${c.lang}"><meta charset="utf-8"><title>${escapeHtml(c.name)}</title><body>${filler}<p id="passage">${escapeHtml(c.excerpt)}</p>${filler}</body></html>`;
}

const { evidence, links } = lessonWithSources();

test('the lesson gives every source a link with a text directive', () => {
  expect(links).toHaveLength(CASES.length);
  for (const [i, href] of links.entries()) {
    expect(href.startsWith(`${HOST}/page-${i + 1}#:~:text=`), href.slice(0, 60)).toBe(true);
    // Only what a text directive allows unescaped: no stray "-" or "&" that would be read as its syntax.
    expect(href.split('#:~:text=')[1]).toMatch(/^[A-Za-z0-9%._]+(,[A-Za-z0-9%._]+)?$/);
  }
});

for (const [i, c] of CASES.entries()) {
  test(`the link lands on the passage: ${c.name}`, async ({ page, context }) => {
    const href = links[i] as string;
    const address = (evidence[i] as Evidence).url;
    // Nothing but the stand-in is ever served, whatever a page asks for.
    await context.route('**/*', (route) => (route.request().url().split('#')[0] === address ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: sourcePage(c) }) : route.abort()));

    // The same page without a directive stays at the top, so a scroll further down is the directive's doing.
    await page.goto(address);
    await expect(page.locator('#passage')).toHaveText(c.excerpt);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator('#passage')).not.toBeInViewport();

    await page.goto('about:blank');
    await page.goto(href);
    await expect.poll(() => page.evaluate(() => Math.round(scrollY)), { message: `scrolled by ${decodeURIComponent(href.split('#:~:')[1] ?? '')}`, timeout: 5000 }).toBeGreaterThan(1000);
    await expect(page.locator('#passage')).toBeInViewport();
  });
}
