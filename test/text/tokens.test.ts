import { describe, expect, it } from 'vitest';
import { contentTokens, countWords, findUrls, numberTokens, sourceNumberTokens } from '../../src/core/text';

describe('countWords', () => {
  const cases: Array<[string, string, string, number]> = [
    ['English', 'Binary search halves the interval.', 'en', 5],
    ['empty', '', 'en', 0],
    ['punctuation only', '... — !?', 'en', 0],
    ['a contraction is one word', "It doesn't matter.", 'en', 3],
    ['a hyphenated compound is two', 'a well-known result', 'en', 4],
    ['numbers are words', 'It takes 20 steps for 1,000,000 items.', 'en', 7],
    ['a decimal is one word', 'pi is 3.14159', 'en', 3],
    ['emphasis delimiters are not counted', 'This is **very** *important* text', 'en', 5],
    ['a code span counts as its words', 'Call `binary_search` now', 'en', 3],
    ['a math span counts as its symbols', 'So $x^2$ grows', 'en', 4],
    ['a fraction in math', 'Half is $\\frac{1}{2}$', 'en', 4],
    ['escaped delimiters are not counted', 'Costs \\$5 and \\*star\\*', 'en', 4],
    ['literal asterisks do not split or add words', 'Pass *args and **kwargs', 'en', 4],
    ['Japanese', '私は学生です', 'ja', 4],
    ['Japanese sentence with punctuation', '二分探索は、ソート済みの配列から値を探す。', 'ja', 11],
    ['Chinese', '我喜欢学习中文', 'zh', 4],
    ['Thai, written without spaces', 'ฉันรักภาษาไทย', 'th', 4],
    ['Thai sentence', 'การค้นหาแบบทวิภาคเร็วมาก', 'th', 6],
    ['Arabic', 'البحث الثنائي سريع جدا', 'ar', 4],
    ['Arabic with punctuation and a number', 'البحث الثنائي، في 20 خطوة.', 'ar', 5],
    ['Korean', '이진 검색은 빠르다', 'ko', 3],
    ['Hindi', 'द्विआधारी खोज तेज़ है', 'hi', 4],
    ['mixed scripts', 'Python の list は速い', 'ja', 5],
    ['a regional tag', 'El algoritmo es rápido', 'es-MX', 4],
  ];
  it.each(cases)('%s', (_name, text, lang, expected) => {
    expect(countWords(text, lang)).toBe(expected);
  });

  it('does not depend on the locale for scripts that need a dictionary', () => {
    // The lesson language may be English while a quote is Japanese or Thai.
    expect(countWords('私は学生です', 'en')).toBe(countWords('私は学生です', 'ja'));
    expect(countWords('ฉันรักภาษาไทย', 'en')).toBe(countWords('ฉันรักภาษาไทย', 'th'));
  });

  const oddTags: Array<[string, string]> = [
    ['a language the runtime has no data for', 'xx'],
    ['Klingon', 'tlh'],
    ['not a language tag at all', 'not a tag'],
    ['empty', ''],
    ['the undetermined language', 'und'],
  ];
  it.each(oddTags)('falls back to a fixed locale, not the machine default, for %s', (_name, lang) => {
    expect(countWords('Binary search halves the interval.', lang)).toBe(5);
    expect(countWords('私は学生です', lang)).toBe(4);
  });

  it('defaults to English', () => {
    expect(countWords('two words')).toBe(2);
  });

  it('always names a locale the runtime has, so Intl never falls back to the machine default', () => {
    // No string was found that this ICU segments differently by locale, so the guarantee is
    // checked where it is made: in what the segmenter is constructed with.
    const Real = Intl.Segmenter;
    const seen: unknown[] = [];
    class Spy extends Real {
      constructor(locales?: Intl.LocalesArgument, options?: Intl.SegmenterOptions) {
        super(locales, options);
        seen.push(locales);
      }
    }
    (Intl as { Segmenter: typeof Intl.Segmenter }).Segmenter = Spy;
    try {
      // Tags no other test uses, because segmenters are cached per tag.
      expect(countWords('one two', 'qq')).toBe(2);
      expect(countWords('one two', 'bad tag!')).toBe(2);
      expect(countWords('one two', 'pt-BR')).toBe(2);
      expect(countWords('one two', 'pt-BR')).toBe(2);
    } finally {
      (Intl as { Segmenter: typeof Intl.Segmenter }).Segmenter = Real;
    }
    expect(seen).toEqual(['en', 'en', 'pt-BR']);
    for (const locale of seen) expect(Real.supportedLocalesOf([locale as string])).toHaveLength(1);
  });
});

describe('contentTokens', () => {
  const cases: Array<[string, string, string, string[]]> = [
    ['lowercases, keeps words of four or more letters, cuts to five', 'Binary Search FINDS the target', 'en', ['binar', 'searc', 'finds', 'targe']],
    ['a four-letter word is kept whole', 'sort data fast', 'en', ['sort', 'data', 'fast']],
    ['words of three letters or fewer are dropped', 'a an the cat sat on it', 'en', []],
    ['inflections share a stem', 'comparing comparison compares compared', 'en', ['compa', 'compa', 'compa', 'compa']],
    ['English stopwords are dropped', 'This would have been there with those which were about', 'en', []],
    ['stopwords are dropped for a regional English tag', 'These results should hold', 'en-GB', ['resul', 'hold']],
    ['stopwords are not dropped for another language', 'These results should hold', 'de', ['these', 'resul', 'shoul', 'hold']],
    ['repeats are kept, in order', 'search and search again', 'en', ['searc', 'searc']],
    ['punctuation and hyphens split', "state-of-the-art, well-known; the dog's bowl", 'en', ['state', 'well', 'known', 'bowl']],
    ['a token needs a letter', 'In 2019 about 1,000,000 items and 3.14159', 'en', ['items']],
    ['letters and digits together make one token', 'the sha256 hash and utf8 text', 'en', ['sha25', 'hash', 'utf8', 'text']],
    ['underscore splits', 'binary_search(items)', 'en', ['binar', 'searc', 'items']],
    ['accents are kept, compatibility forms folded', 'Élégant café ＦＵＬＬ ﬁnally', 'fr', ['éléga', 'café', 'full', 'final']],
    ['NFD input', 'e\u0301le\u0301gant', 'fr', ['éléga']],
    ['Cyrillic', 'Двоичный поиск быстрый', 'ru', ['двоич', 'поиск', 'быстр']],
    ['Arabic', 'البحث الثنائي سريع', 'ar', ['البحث', 'الثنا', 'سريع']],
    ['Chinese as character bigrams', '二分查找', 'zh', ['二分', '分查', '查找']],
    ['Japanese as character bigrams', '探索する', 'ja', ['探索', '索す', 'する']],
    ['a lone CJK character is its own token', '値 を', 'ja', ['値', 'を']],
    ['Korean as character bigrams, per word', '이진 검색은', 'ko', ['이진', '검색', '색은']],
    ['Thai as character bigrams', 'ไทย', 'th', ['ไท', 'ทย']],
    ['CJK punctuation separates runs', '二分。探索', 'ja', ['二分', '探索']],
    ['mixed scripts', 'Python の list は速い binary', 'ja', ['pytho', 'の', 'list', 'は速', '速い', 'binar']],
    ['empty', '', 'en', []],
    ['an emoji is not a token', 'ship 🚀 today', 'en', ['ship', 'today']],
  ];
  it.each(cases)('%s', (_name, text, lang, expected) => {
    expect(contentTokens(text, lang)).toEqual(expected);
  });

  it('a claim that paraphrases its source shares tokens with it; an unrelated one does not', () => {
    const excerpt = new Set(contentTokens('Binary search only works when the data is sorted. On unsorted data the half that is discarded may contain the target.', 'en'));
    const shared = (s: string) => contentTokens(s, 'en').filter((t) => excerpt.has(t));
    expect(shared('Binary search is only reliable when the data is sorted.')).toEqual(['binar', 'searc', 'data', 'sorte']);
    expect(shared('Photosynthesis converts sunlight into chemical energy.')).toEqual([]);
  });
});

describe('numberTokens: normalisation', () => {
  const cases: Array<[string, string, string[]]> = [
    ['comma groups', '1,000,000', ['1000000']],
    ['space groups', '1 000 000', ['1000000']],
    ['dot groups', '1.000.000', ['1000000']],
    ['apostrophe groups (Swiss)', "1'000'000", ['1000000']],
    ['curly apostrophe groups', '1’000’000', ['1000000']],
    ['no-break space groups', '1\u00a0000\u00a0000', ['1000000']],
    ['narrow no-break space groups', '1\u202f000\u202f000', ['1000000']],
    ['thin space groups', '12\u2009345', ['12345']],
    ['one group', '10,000', ['10000']],
    ['no grouping', '1000000', ['1000000']],
    ['a decimal stays distinguishable', '3.13', ['3.13']],
    ['and is not the integer', '313', ['313']],
    ['a decimal comma is written with a point', '12,5', ['12.5']],
    ['long decimals', '3.14159', ['3.14159']],
    ['four digits after a point is a decimal', '1.2345', ['1.2345']],
    ['leading zero is always a decimal', '0.125', ['0.125']],
    ['leading zero with a comma', '0,125', ['0.125']],
    ['English grouping with decimals', '1,234.56', ['1234.56']],
    ['European grouping with decimals', '1.234,56', ['1234.56']],
    ['space grouping with a decimal comma', '1 234,56', ['1234.56']],
    ['space grouping with a decimal point', '1 234.5', ['1234.5']],
    ['a trailing full stop is not a decimal point', 'It takes 20.', ['20']],
    ['a trailing comma', 'in 2019, things', ['2019']],
    ['a list with spaces after the commas', '1, 2, 3', ['1', '2', '3']],
    ['a four-digit year is never the first group', 'in 2019 300 people', ['2019', '300']],
    ['a year and a grouped number', 'in 2019 500 000 people', ['2019', '500000']],
    ['a space cannot group what a comma then groups', 'Apollo 13 200,000 miles', ['13', '200000']],
    ['groups must be exactly three digits', '1,00', ['1.00']],
    ['a fourth digit ends the group', '1,0000', ['1.0000']],
    ['mixed separators do not chain', '1,234,56', ['1234', '56']],
    ['a version with three parts', '3.13.2', ['3.13', '2']],
    ['a date', '2024-05-01', ['2024', '05', '01']],
    ['a time', '12:30', ['12', '30']],
    ['a fraction', '1/2', ['1', '2']],
    ['a range', '10-20', ['10', '20']],
    ['a range with an en dash', '1914–1918', ['1914', '1918']],
    ['a negative number keeps only its digits', '-5 and −7', ['5', '7']],
    ['a percentage', '50%', ['50']],
    ['currency', '$1.5 trillion or €2,50', ['1.5', '2.50']],
    ['an ordinal', 'the 20th and the 1st', ['20', '1']],
    ['digits inside a word', 'ES2015 and sha256', ['2015', '256']],
    ['an exponent', '6.02e23 and 10^8', ['6.02', '23', '10', '8']],
    ['leading zeros are kept', '007', ['007']],
    ['trailing zeros are kept', '2.50', ['2.50']],
    ['no digits', 'nothing to see', []],
    ['empty', '', []],
    ['Arabic-Indic digits', '١٢٣', ['123']],
    ['Arabic-Indic with their own separators', '١٬٢٣٤٫٥', ['1234.5']],
    ['extended Arabic-Indic (Persian) digits', '۱۲۳', ['123']],
    ['Devanagari digits', '१२३', ['123']],
    ['Bengali digits', '১২৩', ['123']],
    ['Thai digits', '๑๒๓', ['123']],
    ['fullwidth digits', '１２３', ['123']],
    ['fullwidth digits with fullwidth separators', '１，２３４．５', ['1234.5']],
    ['mathematical bold digits (outside the BMP)', '𝟏𝟐𝟑', ['123']],
    ['mathematical double-struck digits', '𝟘𝟙𝟚', ['012']],
    ['mixed digit systems in one run', '1２३', ['123']],
    ['superscripts are not decimal digits', 'x² and CO₂', []],
    ['a known limit: three digits after a point read as grouping', '3.142', ['3142']],
    ['a known limit: an address', '192.168.1.1', ['192168', '1.1']],
  ];
  it.each(cases)('%s: %s', (_name, text, expected) => {
    expect(numberTokens(text)).toEqual(expected);
  });

  it('the three ways of writing a million compare equal, and 3.13 equals none of them', () => {
    const forms = ['1,000,000', '1 000 000', '1.000.000'].map((s) => numberTokens(s));
    expect(forms).toEqual([['1000000'], ['1000000'], ['1000000']]);
    expect(numberTokens('3.13')).not.toEqual(numberTokens('313'));
    expect(numberTokens('3.13')).not.toEqual(numberTokens('3,13 00'));
  });
});

describe('numberTokens: digit-bearing topics (the list in the validation rules)', () => {
  // [topic, the tokens it yields]. A lesson's topic exempts these tokens from grounding, so a topic
  // must yield the same tokens on its own and inside a sentence.
  const topics: Array<[string, string[]]> = [
    ['Web3', ['3']],
    ['COVID-19', ['19']],
    ['Python 3.13', ['3.13']],
    ['ES2015', ['2015']],
    ['9/11', ['9', '11']],
    ['401(k)', ['401']],
    ['Catch-22', ['22']],
    ['K-12', ['12']],
    ['Area 51', ['51']],
    ['HTTP/2', ['2']],
    ['the 80/20 rule', ['80', '20']],
    ['Windows 2000', ['2000']],
    ['RFC 2119', ['2119']],
    ['1984 the novel', ['1984']],
    ['HTTP/1.1', ['1.1']],
    ['OAuth 2.0', ['2.0']],
    ['TLS 1.3', ['1.3']],
    ['SHA-256', ['256']],
    ['IPv6', ['6']],
    ['Web 2.0', ['2.0']],
    ['5G networks', ['5']],
    ['Y2K', ['2']],
    ['Apollo 11', ['11']],
    ['Fahrenheit 451', ['451']],
    ['Formula 1', ['1']],
    ['Section 230', ['230']],
    ['the 10,000-hour rule', ['10000']],
    ['Industry 4.0', ['4.0']],
    ['PM2.5', ['2.5']],
    ['Vitamin B12', ['12']],
    ['CO2', ['2']],
    ['x86-64', ['86', '64']],
    ['UTF-8', ['8']],
    ['base64', ['64']],
    ['IEEE 754', ['754']],
    ['802.11ac', ['802.11']],
    ['ISO 8601', ['8601']],
    ['the 1960s', ['1960s']],
    ['Route 66', ['66']],
    ['Boeing 747', ['747']],
    ['the 3-2-1 backup rule', ['3', '2', '1']],
    ['12-factor apps', ['12']],
    ['24/7 support', ['24', '7']],
    ['C++20', ['20']],
    ['GPT-4', ['4']],
    ['the 2008 financial crisis', ['2008']],
    ['Agenda 2030', ['2030']],
    ['Chapter 11 bankruptcy', ['11']],
    ['E = mc^2', ['2']],
    ['4K video', ['4']],
    ['H2O', ['2']],
    ['the 4-7-8 breathing technique', ['4', '7', '8']],
    ['MP3', ['3']],
    ['B-52', ['52']],
    ['3D printing', ['3']],
    ['World War 2', ['2']],
    ['the 1%', ['1']],
    ['uranium-235', ['235']],
    ['a 50/50 split', ['50', '50']],
    ['$1.5 trillion', ['1.5']],
    ['1,000,000 steps', ['1000000']],
  ];

  it('has at least 50 topics', () => {
    expect(topics.length).toBeGreaterThanOrEqual(50);
  });

  it.each(topics)('%s', (topic, expected) => {
    expect(numberTokens(topic)).toEqual(expected);
  });

  const frames: Array<[string, (t: string) => string]> = [
    ['at the end of a sentence', (t) => `This short lesson is about ${t}.`],
    ['before a comma', (t) => `Why does ${t}, of all things, matter?`],
    ['at the start', (t) => `${t} is where we begin.`],
    ['in brackets and quotes', (t) => `The topic (“${t}”) comes first; then the details.`],
    ['after a colon', (t) => `Today: ${t}`],
    ['with emphasis', (t) => `Start with **${t}**, then go on.`],
  ];
  it.each(frames)('every topic yields the same tokens %s', (_name, frame) => {
    for (const [topic, expected] of topics) expect(numberTokens(frame(topic)), frame(topic)).toEqual(expected);
  });
});

// Review finding V1: a number written with characters that cannot be seen between its digits was
// read as single digits, which need no source, while the page showed an ordinary number.
describe('numberTokens: what cannot be seen does not split a number', () => {
  const J = '‍';
  const cases: Array<[string, string, string[]]> = [
    ['zero-width joiners', `in 1${J}9${J}4${J}6.`, ['1946']],
    ['zero-width non-joiners', '3‌5‌0 million', ['350']],
    ['left-to-right marks', '1‎9‎4‎6', ['1946']],
    ['invisible times around the point too', '9⁢9⁢.⁢9%', ['99.9']],
    ['a joiner on each side of a decimal point', `3${J}.${J}7 million`, ['3.7']],
    ['combining grapheme joiners', '1͏9͏4͏6', ['1946']],
    ['variation selectors', '1︎9︎4︎6', ['1946']],
    ['Mongolian vowel separators', '1᠎9᠎4᠎6', ['1946']],
    ['Hangul fillers', '1ㅤ9ㅤ4ㅤ6', ['1946']],
    ['combining marks on the digits', '1̶9̶4̶6̶', ['1946']],
    ['keycap sequences', '1️⃣9️⃣4️⃣6️⃣', ['1946']],
    ['one joiner is enough to notice', `1${J}946`, ['1946']],
    ['grouping still works through a joiner', `1${J},000${J},000`, ['1000000']],
    ['fullwidth digits with joiners', `１${J}９${J}４${J}６`, ['1946']],
    ['a joiner in a word is nothing to do with numbers', `می${J}خواهم 12 کتاب`, ['12']],
    ['an emoji sequence between two numbers', '3 👨‍👩‍👧 4', ['3', '4']],
    ['superscripts stay apart from the number beside them', '10⁶ and 2¹⁰', ['10', '2']],
  ];
  it.each(cases)('%s', (_name, text, expected) => {
    expect(numberTokens(text)).toEqual(expected);
    // The passage reading sees the same number, so an honest pair still matches.
    for (const token of expected) expect(sourceNumberTokens(text)).toContain(token);
  });
});

// Review findings R1, R2 and R3: the same number or date written the way another language, or the
// lesson's own prose, writes it. `numberTokens` reads the statement, `sourceNumberTokens` the
// passage it rests on.
describe('numberTokens: one form for what languages write differently', () => {
  const cases: Array<[string, string, string[]]> = [
    // East Asian units
    ['億 and 万', '総人口は1億2435万人', ['124350000']],
    ['万 and a remainder', '出生数は72万7277人', ['727277']],
    ['万 and 千', '前年より59万5千人減った', ['595000']],
    ['万 alone with several digits', '約8700万人', ['87000000']],
    ['a decimal with one unit', '売上は1.2億円', ['120000000']],
    ['兆 in Japanese', '国の予算は114兆3812億円だった', ['114381200000000']],
    ['fullwidth digits', '１億２４３５万人', ['124350000']],
    ['simplified Chinese', '人口为14亿1175万人', ['1411750000']],
    ['traditional Chinese', '人口約2340萬', ['23400000']],
    ['Korean, with its spaces', '인구는 5175만 명, 예산은 1억 2435만 원', ['51750000', '124350000']],
    ['Korean thousand', '72만 7천 명', ['727000']],
    ['two numbers stay two', '男性は6000万人、女性は6400万人', ['60000000', '64000000']],
    ['single digits are left alone', '約3万人、1億2千万人', ['3', '1', '2']],
    ['the form of financial tables is left alone', '124.35百万人と595千人', ['124.35', '595']],
    ['千 without a larger unit is left alone', '3千人と12千円', ['3', '12']],
    ['兆 in Chinese is also "mega"', '装机容量为300兆瓦', ['300']],
    ['a year after a Korean unit is not its remainder', '3만 2023년', ['3', '2023']],
    ['years, ages and days are untouched', '2023年に65歳以上は15日', ['2023', '65', '15']],
    // months
    ['a month as a numeral', '2023年10月1日時点', ['2023', '1']],
    ['December', '12月25日', ['25']],
    ['a Korean month', '2023년 10월 1일', ['2023', '1']],
    ['a number of months is a quantity', '10か月と12ヶ月', ['10', '12']],
    ['there is no month 13', '13月', ['13']],
    // centuries
    ['a century', 'in the 17th century', []],
    ['a century as an adjective', 'a 17th-century city', []],
    ['two centuries', 'the 16th and 17th centuries', []],
    ['a range of centuries', 'the 16th–17th centuries', []],
    ['German', 'im 17. Jahrhundert', []],
    ['German, two at once', 'im 16./17. Jahrhundert und im 20. Jh.', []],
    ['French', 'au 17e siècle et au 18ème siècle', []],
    ['Dutch', 'in de 17e eeuw', []],
    ['Spanish and Portuguese put the word first', 'en el siglo 17 y no século 20', []],
    ['Japanese, Chinese and Korean', '17世紀、18世纪、19세기', []],
    ['a count of centuries is a quantity', 'for 20 centuries', ['20']],
    ['an ordinal that is not a century', 'the 13th Amendment and the 20th of May', ['13', '20']],
    ['a full stop that ends a sentence', 'It took 17. The century ended.', ['17']],
    // decades
    ['a decade', 'in the 1660s', ['1660s']],
    ['a decade with an apostrophe', "the 1960's", ['1960s']],
    ['a German decade', 'in den 1920er Jahren', ['1920s']],
    ['a Japanese decade', '1960年代', ['1960s']],
    ['a Korean decade', '1960년대', ['1960s']],
    ['a year is not a decade', 'in 1660, and in 1666s', ['1660', '1666']],
    ['thousands of something', '1000s of people', ['1000']],
    // year ranges
    ['a range with an en dash', 'the war (1939–45)', ['1939', '1945']],
    ['a range with a hyphen', 'the 2019-20 season', ['2019', '2020']],
    ['a range over a century boundary', '1999–00', ['1999', '2000']],
    ['a full range is unchanged', '1939–1945', ['1939', '1945']],
    ['a date is not a range', '2001-05-01 and 2024-05-01', ['2001', '05', '01', '2024', '05', '01']],
    ['a short number before a dash is not a year', '86-64 and 300–45', ['86', '64', '300', '45']],
  ];
  it.each(cases)('%s: %s', (_name, text, expected) => {
    expect(numberTokens(text)).toEqual(expected);
  });
});

describe('sourceNumberTokens: what a passage gives a statement to rest on', () => {
  const cases: Array<[string, string, string[]]> = [
    ['a scale word', 'was 124.35 million as of', ['124.35', '124350000']],
    ['thousand', 'a decrease of 595 thousand', ['595', '595000']],
    ['billion and trillion', '$1.5 trillion, or 2 billion', ['1.5', '2', '1500000000000', '2000000000']],
    ['a decimal that outlasts the scale', '1.2345 thousand', ['1.2345', '1234.5']],
    ['trailing zeros of a scaled decimal', '2.50 million', ['2.50', '2500000']],
    ['a hyphen before the word', 'a 5-million-dollar loan', ['5', '5000000']],
    ['abbreviations', '£3.2bn and 14 Mio. Euro', ['3.2', '14', '3200000000', '14000000']],
    ['German, French and Spanish words', '83 Millionen, 67 millions, 47 millones', ['83', '67', '47', '83000000', '67000000', '47000000']],
    ['lakh and crore', '5 lakh and 2.5 crore', ['5', '2.5', '500000', '25000000']],
    ['a word that only starts like one', '3 millionaires and 5 milestones', ['3', '5']],
    ['a name on every object is not a scale', '7 constructor calls', ['7']],
    ['a date with dots', 'am 16.10.2023 verkündet', ['16.10', '2023', '2020s', '2000s', '16', '10']],
    ['a short date', 'trat am 1.1.2024 in Kraft', ['1.1', '2024', '2020s', '2000s', '1']],
    ['a version', 'Python 3.13.2', ['3.13', '2', '3', '13']],
    ['an address', '192.168.1.1', ['192168', '1.1', '192', '168', '1']],
    ['a decimal keeps its digits to itself', '29.1 percent', ['29.1']],
    ['so does a grouped number', '1.234.567 people', ['1234567']],
    ['a time with a dot', 'at 10.30pm and um 14.30 Uhr', ['10.30', '14.30', '10', '30', '14']],
    ['a decimal before an unrelated word', '10.30 metres', ['10.30']],
    ['a year gives its decade and century', 'on 2 September 1666', ['2', '1666', '1660s', '1600s']],
    ['a decade keeps its year', 'in the 1660s', ['1660', '1660s', '1600s']],
    ['a short range keeps both readings', '(1939–45)', ['1939', '45', '1945', '1930s', '1900s']],
    ['a century keeps its number', 'the 17th century', ['17']],
    ['East Asian units keep their parts', '72万7277人', ['72', '7277', '727277']],
    ['a month keeps its number', '10月1日', ['10', '1']],
  ];
  it.each(cases)('%s: %s', (_name, text, expected) => {
    expect(sourceNumberTokens(text)).toEqual(expected);
  });

  it('holds every number the passage states, for any of the forms above', () => {
    for (const [, text] of cases) for (const token of numberTokens(text)) expect(sourceNumberTokens(text), text).toContain(token);
  });
});

describe('a statement against its passage', () => {
  // The rule the validator applies: every stated number of more than one digit is among the passage's.
  const missing = (statement: string, passage: string): string[] => {
    const have = new Set(sourceNumberTokens(passage));
    return [...new Set(numberTokens(statement))].filter((t) => t.length > 1 && !have.has(t));
  };
  const POPULATION = 'The total population of Japan was 124.35 million as of October 1, 2023, a decrease of 595 thousand from the previous year.';
  const BIRTHS = 'The number of births in 2023 was 727,277, while deaths numbered 1,575,936, so the natural decrease exceeded 848,000.';
  const FIRE = 'The Great Fire started on Sunday 2 September 1666 in a bakery on Pudding Lane.';

  it.each([
    ['R1: 億 and 万 against "million"', '2023年10月1日時点の日本の総人口は1億2435万人で、前年より59万5千人減った。', POPULATION],
    ['R1: 万 against grouped digits', '2023年の出生数は72万7277人、死亡数は157万5936人で、自然減は84万8000人を超えた。', BIRTHS],
    ['R1: the forms that passed before still pass', '総人口は124.35百万人で、前年より595千人減った。', POPULATION],
    ['R1: the other way round, digits against a Japanese passage', 'There were 727,277 births.', '出生数は72万7277人だった。'],
    ['R1: Japanese against a Japanese passage', '出生数は72万7277人だった。', '2023年の出生数は72万7277人。'],
    ['R1: Korean against "million"', '일본의 총인구는 1억 2435만 명이다.', POPULATION],
    ['R2: a date written out against a dotted date', 'wurde am 16. Oktober 2023 verkündet und gilt seit dem 1. Januar 2024', 'am 16.10.2023 verkündet und trat am 1.1.2024 in Kraft'],
    ['R2: the same dotted date', 'am 16.10.2023 verkündet', 'am 16.10.2023 verkündet'],
    ['R2: a colon against a dot in a time', 'um 14:30 Uhr', 'um 14.30 Uhr'],
    ['R2: the same in English', '10:30 pm on 31 October', '10.30pm on 31 October'],
    ['R2: a version named in part', 'Python 3.13 added it', 'Python 3.13.2 release notes'],
    ['R3: a century', 'How does a fire end up consuming most of a 17th-century city?', FIRE],
    ['R3: a century in German', 'im 17. Jahrhundert', FIRE],
    ['R3: a decade', 'London in the 1660s', FIRE],
    ['R3: the century as "the 1600s"', 'London in the 1600s', FIRE],
    ['R3: a short range', 'the war (1939–45)', 'The war lasted from 1939 to 1945.'],
    ['R3: a short range against a short range', 'the war of 1939–45', 'during the war (1939–45)'],
    ['a number before a scale word, repeated', 'about 350 million people', 'roughly 350 million speakers'],
    ['a small number before a scale word the passage spells out', 'about 2 million people', 'roughly two million people'],
  ])('rests on it: %s', (_what, statement, passage) => {
    expect(missing(statement, passage)).toEqual([]);
  });

  it.each([
    ['V1: a hidden number nobody sourced', 'first described in 1‍9‍4‍6', FIRE, ['1946']],
    ['R1: ten times too many', '日本の総人口は12億4350万人', POPULATION, ['1243500000']],
    ['R1: one digit wrong', '出生数は72万8277人', BIRTHS, ['728277']],
    ['R1: the agent\'s own rounding', '総人口は約1億2000万人', POPULATION, ['120000000']],
    ['R1: a month does not carry a day', '2023年10月15日', POPULATION, ['15']],
    ['R2: a decimal cut short', '29 percent of 68 million', '29.1 percent of 68.3 million', ['29', '68']],
    ['R2: the middle of a grouped number', '234 people', '1.234.567 people', ['234']],
    ['R2: a day the date does not have', 'am 17. Oktober 2023', 'am 16.10.2023 verkündet', ['17']],
    ['R3: another decade', 'London in the 1670s', FIRE, ['1670s']],
    ['R3: another century', 'London in the 1700s', FIRE, ['1700s']],
    ['R3: a year the passage does not give', 'London in 1660', FIRE, ['1660']],
    ['R3: a range that ends elsewhere', 'the war (1939–46)', 'The war lasted from 1939 to 1945.', ['1946']],
    ['R3: a count of centuries', 'for 20 centuries', FIRE, ['20']],
    ['a scale word does not excuse another number', 'about 360 million people', 'roughly 350 million speakers', ['360']],
  ])('does not rest on it: %s', (_what, statement, passage, expected) => {
    expect(missing(statement, passage)).toEqual(expected);
  });
});

describe('findUrls', () => {
  const cases: Array<[string, string, Array<{ raw: string; host: string }>]> = [
    ['https', 'See https://example.org/page for more.', [{ raw: 'https://example.org/page', host: 'example.org' }]],
    ['http with a port', 'Run http://localhost:3000/api first', [{ raw: 'http://localhost:3000/api', host: 'localhost' }]],
    ['an IPv4 host', 'Open http://127.0.0.1:8080/', [{ raw: 'http://127.0.0.1:8080/', host: '127.0.0.1' }]],
    ['an IPv6 host', 'Open http://[::1]:8080/x', [{ raw: 'http://[::1]:8080/x', host: '[::1]' }]],
    ['the host is lowercased, the raw text is not', 'HTTPS://Example.ORG/Path', [{ raw: 'HTTPS://Example.ORG/Path', host: 'example.org' }]],
    ['credentials are not the host', 'ftp://user:pass@files.example.net:21/f', [{ raw: 'ftp://user:pass@files.example.net:21/f', host: 'files.example.net' }]],
    ['a deceptive user part', 'https://example.com@evil.test/login', [{ raw: 'https://example.com@evil.test/login', host: 'evil.test' }]],
    ['any scheme counts', 'git+ssh://git@github.com/a/b.git', [{ raw: 'git+ssh://git@github.com/a/b.git', host: 'github.com' }]],
    ['starts with www.', 'Visit www.example.com/docs today', [{ raw: 'www.example.com/docs', host: 'www.example.com' }]],
    ['www. in upper case', 'WWW.Example.COM', [{ raw: 'WWW.Example.COM', host: 'www.example.com' }]],
    ['sentence punctuation is not part of the URL', 'Is it https://example.org/a?', [{ raw: 'https://example.org/a', host: 'example.org' }]],
    ['a trailing full stop', 'Go to https://example.org.', [{ raw: 'https://example.org', host: 'example.org' }]],
    ['in brackets', '(see https://example.org/a)', [{ raw: 'https://example.org/a', host: 'example.org' }]],
    ['a bracket that belongs to the URL', 'https://en.wikipedia.org/wiki/Search_(algorithm)', [{ raw: 'https://en.wikipedia.org/wiki/Search_(algorithm)', host: 'en.wikipedia.org' }]],
    ['in quotes', 'fetch("https://api.example.com/v1")', [{ raw: 'https://api.example.com/v1', host: 'api.example.com' }]],
    ['in an attribute', '<a href="https://example.org/x">', [{ raw: 'https://example.org/x', host: 'example.org' }]],
    ['www. in brackets', '(www.example.org).', [{ raw: 'www.example.org', host: 'www.example.org' }]],
    ['in emphasis', 'Read **https://example.org** now', [{ raw: 'https://example.org', host: 'example.org' }]],
    ['a query and a fragment', 'https://example.org/a?b=c#d', [{ raw: 'https://example.org/a?b=c#d', host: 'example.org' }]],
    ['a host with a trailing dot', 'https://example.org./a', [{ raw: 'https://example.org./a', host: 'example.org' }]],
    ['an internationalised host is given in ASCII form', 'https://münchen.de/p', [{ raw: 'https://münchen.de/p', host: 'xn--mnchen-3ya.de' }]],
    ['a possessive after the host', "https://example.org's page", [{ raw: "https://example.org's", host: 'example.org' }]],
    ['two URLs', 'https://a.example and http://b.example/x', [{ raw: 'https://a.example', host: 'a.example' }, { raw: 'http://b.example/x', host: 'b.example' }]],
    ['two URLs in one token', 'https://a.example,https://b.example', [{ raw: 'https://a.example', host: 'a.example' }, { raw: 'https://b.example', host: 'b.example' }]],
    ['a pipe-to-shell line', 'curl -s https://get.example.sh/install | sh', [{ raw: 'https://get.example.sh/install', host: 'get.example.sh' }]],
    ['separated by a newline or a tab', 'a\nhttps://example.org\tb', [{ raw: 'https://example.org', host: 'example.org' }]],
    ['a bare scheme separator', 'the token :// alone', [{ raw: '://', host: '' }]],
    ['no scheme and no www. is not matched', 'example.com/page and docs.example.org', []],
    ['an email address is not matched', 'write to someone@example.org', []],
    ['"www." alone is not a URL', 'the prefix www. is common', []],
    ['a word that merely contains www', 'awww.cute', []],
    ['a ratio or a time', 'at 12:30 the ratio is 3:1 // done', []],
    ['empty', '', []],
  ];
  it.each(cases)('%s', (_name, text, expected) => {
    expect(findUrls(text)).toEqual(expected);
  });
});
