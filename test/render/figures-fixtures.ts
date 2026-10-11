// Fixtures for the figure tests: the one example of each type from the contract, and harder cases
// that push each drawing to the limits the schema allows. Used by test/render/figures*.test.ts and,
// through test/player/figures-kit.ts, by test/player/figures*.spec.ts. Data only: nothing here
// needs a browser.
import { EXAMPLE_FIGURES } from '../../src/core/examples';
import { Figure, type Scene } from '../../src/core/schema';
import type { FigureInput, Published } from '../../src/core/types';
import { examplePublished } from '../helpers/example';

const cites = ['e1'];

/** Twelve nodes, sixteen edges: two branches, two joins, a skip and two loops back. */
const flow12: FigureInput = {
  type: 'flow',
  layout: 'down',
  nodes: [
    { id: 'commit', label: 'Commit pushed' },
    { id: 'lint', label: 'Lint', detail: 'Style and static checks' },
    { id: 'unit', label: 'Unit tests' },
    { id: 'build', label: 'Build the image' },
    { id: 'scan', label: 'Security scan', detail: 'Known vulnerabilities in dependencies' },
    { id: 'integ', label: 'Integration tests' },
    { id: 'review', label: 'Human review' },
    { id: 'staging', label: 'Deploy to staging' },
    { id: 'smoke', label: 'Smoke tests' },
    { id: 'prod', label: 'Deploy to production' },
    { id: 'watch', label: 'Watch the error rate' },
    { id: 'rollback', label: 'Roll back', detail: 'Return to the last good release' },
  ],
  edges: [
    { id: 'e-lint', from: 'commit', to: 'lint' },
    { id: 'e-unit', from: 'commit', to: 'unit' },
    { id: 'e-lb', from: 'lint', to: 'build', label: 'clean' },
    { id: 'e-ub', from: 'unit', to: 'build', label: 'green' },
    { id: 'e-scan', from: 'build', to: 'scan' },
    { id: 'e-integ', from: 'build', to: 'integ' },
    { id: 'e-sr', from: 'scan', to: 'review' },
    { id: 'e-ir', from: 'integ', to: 'review' },
    { id: 'e-stage', from: 'review', to: 'staging', label: 'approved' },
    { id: 'e-redo', from: 'review', to: 'commit', label: 'changes requested', dashed: true },
    { id: 'e-smoke', from: 'staging', to: 'smoke' },
    { id: 'e-prod', from: 'smoke', to: 'prod', label: 'pass' },
    { id: 'e-watch', from: 'prod', to: 'watch' },
    { id: 'e-roll', from: 'watch', to: 'rollback', label: 'errors rise' },
    { id: 'e-again', from: 'rollback', to: 'commit', label: 'fix forward', dashed: true },
    { id: 'e-hot', from: 'unit', to: 'staging', label: 'hotfix' },
  ],
  cites,
  description:
    'A delivery pipeline. A commit is linted and unit tested, built, scanned and integration tested, reviewed, deployed to staging and smoke tested, then deployed to production and watched. A review can send it back, and rising errors trigger a rollback.',
  caption: 'From a commit to production, and back',
};

const flowRight: FigureInput = {
  type: 'flow',
  layout: 'right',
  nodes: [
    { id: 'src', label: 'Source text' },
    { id: 'lex', label: 'Lexer', detail: 'Characters to tokens' },
    { id: 'parse', label: 'Parser', detail: 'Tokens to a tree' },
    { id: 'emit', label: 'Code generator' },
  ],
  edges: [
    { id: 'a', from: 'src', to: 'lex' },
    { id: 'b', from: 'lex', to: 'parse', label: 'tokens' },
    { id: 'c', from: 'parse', to: 'emit', label: 'syntax tree' },
    { id: 'd', from: 'parse', to: 'lex', label: 'next token', dashed: true },
  ],
  cites,
  description: 'A compiler front end, left to right: source text goes through the lexer and the parser to the code generator. The parser asks the lexer for each next token.',
};

/** A branch and a join set out left to right, with a labelled skip. */
const flowRightBranch: FigureInput = {
  type: 'flow',
  layout: 'right',
  nodes: [
    { id: 'req', label: 'Request' },
    { id: 'cache', label: 'Cache lookup' },
    { id: 'db', label: 'Database query' },
    { id: 'resp', label: 'Response' },
  ],
  edges: [
    { id: 'a', from: 'req', to: 'cache' },
    { id: 'b', from: 'cache', to: 'db', label: 'miss' },
    { id: 'c', from: 'db', to: 'resp' },
    { id: 'd', from: 'cache', to: 'resp', label: 'hit' },
  ],
  cites,
  description: 'A request first looks in the cache. On a hit the response is sent at once; on a miss the database is queried first.',
};

const flowRing: FigureInput = {
  type: 'flow',
  layout: 'ring',
  nodes: [
    { id: 'evap', label: 'Evaporation', detail: 'Water becomes vapour' },
    { id: 'cond', label: 'Condensation', detail: 'Vapour forms clouds' },
    { id: 'precip', label: 'Precipitation' },
    { id: 'collect', label: 'Collection', detail: 'Rivers, lakes and oceans' },
    { id: 'infil', label: 'Infiltration' },
  ],
  edges: [
    { id: 'r1', from: 'evap', to: 'cond' },
    { id: 'r2', from: 'cond', to: 'precip' },
    { id: 'r3', from: 'precip', to: 'collect', label: 'runoff' },
    { id: 'r4', from: 'collect', to: 'infil' },
    { id: 'r5', from: 'infil', to: 'evap', label: 'springs' },
    { id: 'r6', from: 'precip', to: 'infil', label: 'soaks in', dashed: true },
  ],
  cites,
  description: 'The water cycle as a ring: evaporation, condensation, precipitation, collection and infiltration, and round again. Some rain soaks straight into the ground.',
};

const flowRing12: FigureInput = {
  type: 'flow',
  layout: 'ring',
  nodes: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m) => ({ id: m.toLowerCase(), label: m })),
  edges: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].map((m, i, all) => ({
    id: `to-${all[(i + 1) % 12]}`,
    from: m,
    to: all[(i + 1) % 12] as string,
  })),
  cites,
  description: 'The twelve months of the year in a ring, each leading to the next and December leading back to January.',
};

/**
 * Ten nodes in a ring with two connections that are not part of it: "again" joins two nodes of the
 * same column once the ring is set out in two columns, and "in time" crosses from one column to
 * the other. Review finding P3: both were drawn straight through the boxes in between.
 */
const flowRing10: FigureInput = {
  type: 'flow',
  layout: 'ring',
  nodes: [
    { id: 'send', label: 'Send a segment' },
    { id: 'timer', label: 'Start the timer' },
    { id: 'wait', label: 'Wait for the acknowledgment' },
    { id: 'expire', label: 'Timer expires' },
    { id: 'double', label: 'Double the timeout' },
    { id: 'resend', label: 'Send the segment again' },
    { id: 'ack', label: 'Acknowledgment arrives' },
    { id: 'slide', label: 'Slide the window' },
    { id: 'grow', label: 'Grow the window' },
    { id: 'next', label: 'Pick the next segment' },
  ],
  edges: [
    { id: 'a', from: 'send', to: 'timer' },
    { id: 'b', from: 'timer', to: 'wait' },
    { id: 'c', from: 'wait', to: 'expire', label: 'nothing arrives' },
    { id: 'c2', from: 'expire', to: 'double' },
    { id: 'c3', from: 'double', to: 'resend' },
    { id: 'again', from: 'resend', to: 'timer', label: 'again', dashed: true },
    { id: 'd', from: 'wait', to: 'ack', label: 'in time' },
    { id: 'e', from: 'ack', to: 'slide' },
    { id: 'e2', from: 'slide', to: 'grow' },
    { id: 'e3', from: 'grow', to: 'next' },
    { id: 'f', from: 'next', to: 'send' },
  ],
  cites,
  description:
    'A cycle of ten boxes. The sender sends a segment, starts the timer and waits. If nothing arrives the timer expires, the timeout doubles, the segment is sent again, and a dashed arrow goes back to starting the timer. If the acknowledgment arrives in time the window slides and grows and the next segment is picked.',
};

/** Five actors and twelve messages: a self-message, a lost message and its retry. */
const sequence12: FigureInput = {
  type: 'sequence',
  actors: [
    { id: 'browser', label: 'Browser' },
    { id: 'cdn', label: 'CDN edge' },
    { id: 'api', label: 'API gateway' },
    { id: 'auth', label: 'Auth service' },
    { id: 'db', label: 'Database' },
  ],
  messages: [
    { id: 'm1', from: 'browser', to: 'cdn', label: 'GET /orders' },
    { id: 'm2', from: 'cdn', to: 'api', label: 'forward, cache miss' },
    { id: 'm3', from: 'api', to: 'auth', label: 'check the session token' },
    { id: 'm4', from: 'auth', to: 'auth', label: 'verify the signature' },
    { id: 'm5', from: 'auth', to: 'api', label: 'token is valid' },
    { id: 'm6', from: 'api', to: 'db', label: 'query orders for this user', status: 'lost' },
    { id: 'm7', from: 'api', to: 'api', label: 'wait for the timeout' },
    { id: 'm8', from: 'api', to: 'db', label: 'query again' },
    { id: 'm9', from: 'db', to: 'api', label: 'twelve rows' },
    { id: 'm10', from: 'api', to: 'cdn', label: '200 with the orders as JSON' },
    { id: 'm11', from: 'cdn', to: 'cdn', label: 'store in the cache' },
    { id: 'm12', from: 'cdn', to: 'browser', label: '200 OK' },
  ],
  cites,
  description:
    'A browser asks a CDN edge for a list of orders. The edge forwards it to the API gateway, which checks the session with the auth service and queries the database. The first query is lost, so the gateway waits and asks again before the answer travels back.',
  caption: 'One request, one lost query',
};

const layers8: FigureInput = {
  type: 'layers',
  layers: [
    { id: 'app', label: 'Application', detail: 'HTTP, DNS, SMTP: what programs say to each other' },
    { id: 'pres', label: 'Presentation', detail: 'Encoding, compression, encryption' },
    { id: 'sess', label: 'Session', detail: 'Opening, keeping and closing a conversation' },
    { id: 'trans', label: 'Transport', detail: 'TCP and UDP: ports, ordering, retransmission' },
    { id: 'net', label: 'Network', detail: 'IP: addressing and routing between networks' },
    { id: 'link', label: 'Data link', detail: 'Frames on one physical link, such as Ethernet' },
    { id: 'phys', label: 'Physical' },
    { id: 'medium', label: 'The medium itself', detail: 'Copper, glass fibre or radio' },
  ],
  cites,
  description: 'Eight layers, top first, from the application a person uses down to the cable or radio wave that carries the signal.',
};

const timeline10: FigureInput = {
  type: 'timeline',
  events: [
    { id: 't1', when: '1969', label: 'First ARPANET link', detail: 'Two computers, in Los Angeles and Stanford, exchange a message.' },
    { id: 't2', when: '1971', label: 'First network email' },
    { id: 't3', when: '1974', label: 'TCP is described' },
    { id: 't4', when: '1 January 1983', label: 'ARPANET switches to TCP/IP', detail: 'Every host changes protocol on the same day.' },
    { id: 't5', when: '1984', label: 'The domain name system' },
    { id: 't6', when: '1989', label: 'A proposal for the web' },
    { id: 't7', when: 'August 1991', label: 'The first website goes public' },
    { id: 't8', when: '1993', label: 'A graphical browser' },
    { id: 't9', when: 'mid-1990s', label: 'Commercial traffic is allowed', detail: 'The network stops being a research project.' },
    { id: 't10', when: 'about 25 years later', label: 'More than half the world is online' },
  ],
  cites,
  description: 'Ten moments in the history of the internet, from the first ARPANET link in 1969 to the point where more than half the world was online.',
};

const compare4x8: FigureInput = {
  type: 'compare',
  rowHeading: 'Property',
  columns: [
    { id: 'arr', label: 'Array' },
    { id: 'list', label: 'Linked list' },
    { id: 'hash', label: 'Hash table' },
    { id: 'tree', label: 'Balanced tree' },
  ],
  rows: [
    { id: 'idx', label: 'Read by position', cells: ['Constant time', 'Walk from the head', 'Not supported', 'Logarithmic with a size field'] },
    { id: 'find', label: 'Find a value', cells: ['Scan, or `log n` if sorted', 'Scan every node', 'Constant time on average', 'Logarithmic'] },
    { id: 'ins', label: 'Insert at the front', cells: ['Shift every element', 'Constant time', 'Constant time on average', 'Logarithmic'] },
    { id: 'del', label: 'Delete a known item', cells: ['Shift what follows', 'Constant time with a pointer to it', 'Constant time on average', 'Logarithmic'] },
    { id: 'ord', label: 'Keeps an order', cells: ['Insertion order', 'Insertion order', 'No order at all', 'Sorted by key'] },
    { id: 'mem', label: 'Extra memory', cells: ['None', 'One or two pointers per item', 'Empty buckets', 'Two pointers and a balance mark per item'] },
    { id: 'cache', label: 'Cache behaviour', cells: ['Excellent: one block', 'Poor: nodes are scattered', 'Poor on collisions', 'Fair'] },
    { id: 'use', label: 'Reach for it when', cells: ['You index far more than you insert', 'You splice in the middle', 'You look up by key', 'You need order and fast lookup together'] },
  ],
  cites,
  description: 'Four data structures compared on eight properties: reading by position, finding, inserting, deleting, ordering, memory, cache behaviour and typical use.',
};

const chartLine3: FigureInput = {
  type: 'chart',
  mark: 'line',
  data: 'illustrative',
  xLabel: 'Requests per second',
  yLabel: 'Median response time',
  unit: 'ms',
  xs: ['100', '200', '400', '800', '1,600', '3,200', '6,400', '12,800'].map((label, i) => ({ id: `x${i + 1}`, label })),
  series: [
    { id: 'single', label: 'One server', values: [12, 13, 16, 24, 48, 130, 420, 1400] },
    { id: 'pool', label: 'Pool of four', values: [14, 14, 15, 17, 21, 30, 52, 118] },
    { id: 'cached', label: 'Pool with a cache', values: [9, 9, 9, 10, 11, 12, 15, 21] },
  ],
  cites,
  description: 'Median response time against load for three set-ups. One server slows sharply past 1,600 requests per second; a pool of four holds until much later; adding a cache keeps it nearly flat.',
  caption: 'Where each set-up starts to queue',
};

/** A line whose values differ in the fourth digit. Review finding P2: its axis read "100, 100, 100, 99.9, 99.8". */
const chartLineNarrow: FigureInput = {
  type: 'chart',
  mark: 'line',
  data: 'sourced',
  xLabel: 'Test day',
  yLabel: 'Latency index',
  xs: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((label, i) => ({ id: `d${i + 1}`, label })),
  series: [{ id: 'idx', label: 'Latency index', values: [99.8, 99.9, 100, 100.1, 100.2] }],
  cites,
  description: 'A line chart of the latency index over five test days, creeping from 99.8 to 100.2.',
};

const chartStep16: FigureInput = {
  type: 'chart',
  mark: 'step',
  data: 'illustrative',
  xLabel: 'Round trip',
  yLabel: 'Congestion window',
  unit: 'segments',
  xs: Array.from({ length: 16 }, (_, i) => ({ id: `rt${i + 1}`, label: String(i + 1) })),
  series: [{ id: 'cwnd', label: 'Window', values: [1, 2, 4, 8, 16, 17, 18, 19, 20, 10, 11, 12, 13, 14, 15, 16] }],
  cites,
  description: 'The congestion window over sixteen round trips. It doubles each round trip up to 16 segments, then grows by one, is halved from 20 to 10 at a loss, and grows by one again.',
};

const chartStep2: FigureInput = {
  type: 'chart',
  mark: 'step',
  data: 'illustrative',
  xLabel: 'Hour of the day',
  yLabel: 'Running instances',
  xs: ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'].map((label, i) => ({ id: `h${i}`, label })),
  series: [
    { id: 'web', label: 'Web tier', values: [2, 2, 2, 3, 6, 8, 9, 8, 8, 6, 4, 2] },
    { id: 'jobs', label: 'Batch workers', values: [6, 6, 4, 1, 1, 1, 1, 1, 1, 2, 4, 6] },
  ],
  cites,
  description: 'Instances running through one day. The web tier scales up for the working day and down at night, while batch workers do the opposite.',
};

const chartBar3: FigureInput = {
  type: 'chart',
  mark: 'bar',
  data: 'sourced',
  xLabel: 'Sorting algorithm',
  yLabel: 'Comparisons',
  xs: [
    { id: 'bubble', label: 'Bubble sort' },
    { id: 'insertion', label: 'Insertion sort' },
    { id: 'merge', label: 'Merge sort' },
    { id: 'quick', label: 'Quicksort' },
    { id: 'heap', label: 'Heapsort' },
  ],
  series: [
    { id: 'sorted', label: 'Already sorted', values: [999, 999, 5044, 9009, 17583] },
    { id: 'random', label: 'Random order', values: [498501, 247753, 8704, 10963, 16852] },
    { id: 'reversed', label: 'Reversed', values: [499500, 499500, 4932, 9016, 15965] },
  ],
  cites,
  description: 'Comparisons made by five sorting algorithms on a thousand items in three starting orders. Bubble and insertion sort need about half a million on random or reversed input; the other three stay under twenty thousand.',
};

const chartBar1: FigureInput = {
  type: 'chart',
  mark: 'bar',
  data: 'sourced',
  xLabel: 'Planet',
  yLabel: 'Surface gravity',
  unit: 'm/s²',
  xs: [
    { id: 'mercury', label: 'Mercury' },
    { id: 'venus', label: 'Venus' },
    { id: 'earth', label: 'Earth' },
    { id: 'mars', label: 'Mars' },
  ],
  series: [{ id: 'g', label: 'Gravity', values: [3.7, 8.87, 9.81, 3.72] }],
  cites,
  description: 'Surface gravity of the four inner planets. Earth and Venus are close to 9 metres per second squared; Mercury and Mars are under 4.',
};

const chartBarNeg: FigureInput = {
  type: 'chart',
  mark: 'bar',
  data: 'illustrative',
  xLabel: 'Quarter',
  yLabel: 'Change in latency',
  unit: '%',
  xs: [
    { id: 'q1', label: 'Q1' },
    { id: 'q2', label: 'Q2' },
    { id: 'q3', label: 'Q3' },
    { id: 'q4', label: 'Q4' },
    { id: 'q5', label: 'Q1 next year' },
    { id: 'q6', label: 'Q2 next year' },
  ],
  series: [
    { id: 'p50', label: 'Median', values: [-4, -12, 3, -8, -15, 2.5] },
    { id: 'p99', label: '99th percentile', values: [6, -20, 14, -2, -31, 9] },
  ],
  cites,
  description: 'Quarter-on-quarter change in latency. Most quarters improve, shown as bars below zero; the third quarter and the last get worse.',
};

const lines24: FigureInput = {
  type: 'lines',
  format: 'code',
  language: 'TypeScript',
  lines: [
    'export async function retry<T>(task: () => Promise<T>, options: RetryOptions = {}): Promise<T> {',
    '  const { attempts = 5, baseDelayMs = 200, maxDelayMs = 10_000, jitter = true } = options;',
    '  let lastError: unknown;',
    '',
    '  for (let attempt = 1; attempt <= attempts; attempt++) {',
    '    try {',
    '      return await task();',
    '    } catch (error) {',
    '      lastError = error;',
    '      if (!isRetryable(error) || attempt === attempts) {',
    '        break;',
    '      }',
    '',
    '      // Exponential backoff: 200 ms, 400 ms, 800 ms ... capped at maxDelayMs.',
    '      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));',
    '      const delay = jitter ? Math.random() * exponential : exponential;',
    '      await new Promise((resolve) => setTimeout(resolve, delay));',
    '    }',
    '  }',
    '',
    '  throw new RetryError(`gave up after ${attempts} attempts`, { cause: lastError });',
    '}',
    '',
    'const isRetryable = (error: unknown): boolean => error instanceof NetworkError || isTimeout(error);',
  ],
  description: 'A twenty-four line TypeScript function that runs a task, and on a retryable failure waits for an exponentially growing, randomised delay before trying again, up to a fixed number of attempts.',
};

const linesMath: FigureInput = {
  type: 'lines',
  format: 'math',
  lines: ['x^2 + 6x + 5 = 0', 'x^2 + 6x = -5', 'x^2 + 6x + 9 = 4', '(x + 3)^2 = 4', 'x + 3 = \\pm 2', 'x = -1 \\text{ or } x = -5'],
  cites,
  description: 'Completing the square in six lines: move the constant, add nine to both sides, write the left as a square, take the root, and solve for the two values of x.',
};

/**
 * Working with fractions: the lines of a lesson built in the trials (Bayes' theorem), where the
 * fractions were too small to read, and a sum that fits a desk's column but is wider than a phone
 * however it is wrapped.
 */
const linesWorking: FigureInput = {
  type: 'lines',
  format: 'math',
  lines: [
    '\\text{chance of cancer if positive} = \\frac{\\text{positives with cancer}}{\\text{all positives}}',
    '\\frac{8}{8 + 95} = \\frac{8}{103} \\approx 0.078',
    '\\frac{0.01 \\times 0.80}{0.01 \\times 0.80 + 0.99 \\times 0.096} \\approx 0.078',
    'P(A|B) = \\frac{P(B|A) \\times P(A)}{P(B)}',
    'S = 1.25 + 2.5 + 3.75 + 5 + 6.25 + 7.5 + 8.75',
    'x = -5',
  ],
  cites,
  description:
    'Six lines of working. The chance of cancer given a positive result is the positives with cancer over all positives: 8 over 103, about 0.078, with counts and again with percentages. Then the same as a formula, a sum of seven terms, and a last line with a minus sign.',
};

const linesText: FigureInput = {
  type: 'lines',
  format: 'text',
  lines: ['All humans are mortal.', 'Socrates is a human.', 'Therefore Socrates is mortal.'],
  description: 'A three-line syllogism: a general rule, a particular case, and the conclusion that follows from the two.',
};

export const HARD_FIGURES = {
  flow12,
  flowRight,
  flowRightBranch,
  flowRing,
  flowRing12,
  flowRing10,
  sequence12,
  layers8,
  timeline10,
  compare4x8,
  chartLine3,
  chartLineNarrow,
  chartStep16,
  chartStep2,
  chartBar3,
  chartBar1,
  chartBarNeg,
  lines24,
  linesMath,
  linesWorking,
  linesText,
} satisfies Record<string, FigureInput>;

export type HardFigure = keyof typeof HARD_FIGURES;

function hostileChart(mark: 'line' | 'bar' | 'step', series: number[][]): FigureInput {
  return {
    type: 'chart',
    mark,
    data: 'illustrative',
    xLabel: 'Position',
    yLabel: 'Value',
    xs: (series[0] as number[]).map((_, i) => ({ id: `x${i + 1}`, label: String.fromCharCode(65 + i) })),
    series: series.map((values, j) => ({ id: `s${j + 1}`, label: `Series ${j + 1}`, values })),
    cites,
    description: 'A chart whose values are as close together, as small or as large as the format allows.',
  };
}

/**
 * Charts whose numbers the format accepts and the axis arithmetic once could not survive (review
 * finding H1): each of these froze the page or left it without a chart. They are kept out of
 * `HARD_FIGURES`, and a spec opens them only after the arithmetic has been shown to return for
 * their values in a guarded worker (see figures-guard.ts).
 */
export const HOSTILE_CHARTS = {
  // 0.1 + 0.2 beside 0.3: the published lesson that never finished loading.
  noiseLine: hostileChart('line', [
    [0.1 + 0.2, 0.3, 0.1 + 0.2, 0.3],
    [0.3, 0.3, 0.3, 0.3],
  ]),
  noiseBar: hostileChart('bar', [
    [0.1 + 0.2, 0.3, 0.1 + 0.2, 0.3],
    [0.3, 0.3, 0.3, 0.3],
  ]),
  // The smallest numbers there are, of both signs.
  subnormalLine: hostileChart('line', [[5e-324, -5e-324, 5e-324, -5e-324]]),
  subnormalBar: hostileChart('bar', [[5e-324, -5e-324, 5e-324, -5e-324]]),
  subnormalStep: hostileChart('step', [[5e-324, -5e-324, 5e-324, -5e-324]]),
  // The largest value the format allows, and its neighbour.
  limitLine: hostileChart('line', [[1e12 - 1e-4, 1e12, 1e12 - 1e-4, 1e12]]),
  // Twelve significant digits and a spread in the last three: the axis collapsed and the line was drawn at "NaN".
  twelveDigits: hostileChart('line', [[123456789012.345, 123456789012.348, 123456789012.346, 123456789012.347]]),
  // Small but honest: a tick label was once fifty zeros long.
  tinyLine: hostileChart('line', [[1e-50, 3e-50, 2e-50, 4e-50]]),
  tinyBar: hostileChart('bar', [[1e-50, 3e-50, 2e-50, 4e-50]]),
  // The same value at every position, and a single x position repeated.
  flatLine: { ...hostileChart('line', [[7, 7, 7, 7]]), xs: [1, 2, 3, 4].map((i) => ({ id: `x${i}`, label: 'Day' })) } as FigureInput,
  flatBar: hostileChart('bar', [[0, 0, 0, 0]]),
} satisfies Record<string, FigureInput>;

/** Every fixture by name: the seven examples as "ex-<type>", then the hard cases. */
export const ALL_FIGURES: ReadonlyMap<string, FigureInput> = new Map<string, FigureInput>([
  ...Object.entries(EXAMPLE_FIGURES).map(([type, figure]) => [`ex-${type}`, figure] as [string, FigureInput]),
  ...Object.entries(HARD_FIGURES),
]);

/** Scene ids are lowercase with dashes; fixture names are camelCase. */
export function sceneIdFor(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/[^a-z0-9-]/g, '-');
}

export interface FigureSceneOptions {
  /** Part ids to highlight, one list per step. Given, the scene is a step-through; otherwise a narration scene. */
  steps?: readonly (readonly string[])[];
}

/** One scene that shows a figure. The figure goes through the schema, so defaults are applied as they are at publish time. */
export function figureScene(name: string, figure: FigureInput, opts: FigureSceneOptions = {}): Scene {
  const parsed = Figure.parse(figure);
  const id = sceneIdFor(name);
  if (opts.steps) {
    return {
      id,
      kind: 'step_through',
      title: `Figure ${name}, step by step`,
      figure: parsed,
      steps: opts.steps.map((highlight, i) => ({ title: `Step ${i + 1}`, highlight: [...highlight], blocks: [{ type: 'claim', text: `Step ${i + 1} points at ${highlight.join(', ') || 'nothing'}.`, cites: ['e1'] }] })),
    };
  }
  return { id, kind: 'narration', title: `Figure ${name}`, blocks: [{ type: 'claim', text: 'Binary search halves the interval on every comparison.', cites: ['e1'] }], figure: parsed };
}

/**
 * A lesson whose scenes are the named figures, one per scene, followed by the example's recap so
 * the document is still a whole lesson. Rendering does not validate, so the scene count is free.
 */
export function figuresPublished(names: readonly string[] = [...ALL_FIGURES.keys()], opts: Record<string, FigureSceneOptions> = {}): Published {
  const published = examplePublished();
  const recap = published.lesson.scenes.at(-1) as Scene;
  const hostile = new Map<string, FigureInput>(Object.entries(HOSTILE_CHARTS));
  const scenes = names.map((name) => {
    // A hostile chart is found only by a spec that names it: it is not one of "all the figures".
    const figure = ALL_FIGURES.get(name) ?? hostile.get(name);
    if (!figure) throw new Error(`no figure fixture called ${name}`);
    return figureScene(name, figure, opts[name]);
  });
  published.lesson.scenes = [...scenes, recap];
  return published;
}

/** The DOM id the renderer gives a part, for the ids these fixtures use. */
export function partId(sceneId: string, part: string): string {
  return `lt-${sceneId.replaceAll('-', '--')}-${part}`;
}
