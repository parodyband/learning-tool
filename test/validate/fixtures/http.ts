// A lesson on an ordinary technical topic, written the way an agent writes one: status codes in
// claims, in a table, on the arrows of a sequence diagram and in code. The sources are synthetic
// (example.* hosts) and say so nowhere but here; the wording follows what real documentation says.
import type { EvidenceInput, PlanInput } from '../../../src/core/schema';
import type { SceneInput, StartInputRaw } from '../../../src/core/types';
import type { LessonParts } from '../helpers';

const start: StartInputRaw = {
  topic: 'HTTP status codes',
  depth: 'standard',
  learner: { level: 'some', knows: 'Has built a small website and seen 404 pages.', goal: 'Read a status code and know what to do about it.' },
};

const evidence: EvidenceInput[] = [
  { url: 'https://developer.example.org/docs/http/status', title: 'HTTP response status codes', publisher: 'Example Developer Docs', via: 'page' as const,
    excerpt: 'HTTP response status codes indicate whether a specific HTTP request has been successfully completed. Responses are grouped in five classes: informational responses (100 – 199), successful responses (200 – 299), redirection messages (300 – 399), client error responses (400 – 499), and server error responses (500 – 599).' },
  { url: 'https://developer.example.org/docs/http/status/404', title: '404 Not Found', publisher: 'Example Developer Docs', via: 'page' as const,
    excerpt: 'The HTTP 404 Not Found client error response status code indicates that the server cannot find the requested resource. Links that lead to a 404 page are often called broken or dead links.' },
  { url: 'https://developer.example.org/docs/http/status/301', title: '301 Moved Permanently', publisher: 'Example Developer Docs', via: 'page' as const,
    excerpt: 'The HTTP 301 Moved Permanently redirection response status code indicates that the requested resource has been permanently moved to the URL in the Location header. A browser redirects to the new URL and search engines update their links to the resource.' },
  { url: 'https://standards.example.net/rfc/9110', title: 'HTTP Semantics (RFC 9110)', publisher: 'Example Standards Mirror', via: 'page' as const,
    excerpt: 'The status code of a response is a three-digit integer code that describes the result of the request and the semantics of the response. The first digit of the status code defines the class of response. The last two digits do not have any categorization role.' },
  { url: 'https://standards.example.net/rfc/9110#500', title: 'HTTP Semantics: 500', publisher: 'Example Standards Mirror', via: 'page' as const,
    excerpt: 'The 500 (Internal Server Error) status code indicates that the server encountered an unexpected condition that prevented it from fulfilling the request.' },
  { url: 'https://developer.example.org/docs/http/status/503', title: '503 Service Unavailable', publisher: 'Example Developer Docs', via: 'search_snippet' as const,
    excerpt: 'The HTTP 503 Service Unavailable server error response status code indicates that the server is not ready to handle the request. Common causes are that a server is down for maintenance or overloaded.' },
];

const plan: PlanInput = {
  title: 'HTTP status codes: read the first digit',
  objectives: [
    { id: 'o1', text: 'Tell which class a status code belongs to from its first digit' },
    { id: 'o2', text: 'Decide whether the fix belongs on the client or on the server' },
  ],
  outline: [
    { id: 'intro', kind: 'narration', purpose: 'Hook: every response starts with three digits' },
    { id: 'classes', kind: 'narration', purpose: 'The five classes at a glance', figure: 'compare' },
    { id: 'exchange', kind: 'step_through', purpose: 'Follow one request that is redirected, then fails', figure: 'sequence' },
    { id: 'check-class', kind: 'checkpoint', purpose: 'Classify an unfamiliar code', question: 'single', objective: 'o1' },
    { id: 'whose-fault', kind: 'narration', purpose: '4xx versus 5xx: who has to change something' },
    { id: 'check-fix', kind: 'checkpoint', purpose: 'Decide where the fix belongs', question: 'single', objective: 'o2' },
    { id: 'in-code', kind: 'step_through', purpose: 'Handle the classes in code', figure: 'lines' },
    { id: 'check-order', kind: 'checkpoint', purpose: 'Order the classes', question: 'order', objective: 'o1' },
    { id: 'recap', kind: 'recap', purpose: 'Takeaways and next steps' },
  ],
};

const scenes = [
  {
    id: 'intro', kind: 'narration', title: 'Three digits that tell you what happened',
    blocks: [
      { type: 'framing', text: 'You have seen a 404 page. What is that number actually telling you?' },
      { type: 'claim', text: 'Every HTTP response carries a status code: a three-digit number that describes the result of the request.', cites: ['e4'] },
      { type: 'claim', text: 'The first digit defines the class of the response, and the last two digits play no part in that classification.', cites: ['e4'] },
      { type: 'analogy', text: 'It works like the first digit of a postcode: before you know the exact street, you already know the region.', limits: 'A postcode narrows down a place. A status class only tells you the kind of outcome.' },
    ],
  },
  {
    id: 'classes', kind: 'narration', title: 'Five classes',
    blocks: [
      { type: 'claim', text: 'Status codes fall into five classes: informational (100–199), successful (200–299), redirection (300–399), client error (400–499) and server error (500–599).', cites: ['e1'] },
      { type: 'framing', text: 'You do not need to memorise individual codes. Learn the five rows below.' },
    ],
    figure: {
      type: 'compare', rowHeading: 'Class',
      columns: [{ id: 'range', label: 'Range' }, { id: 'meaning', label: 'What it means' }, { id: 'example', label: 'Example' }],
      rows: [
        { id: 'c1xx', label: '1xx', cells: ['100–199', 'Informational', '`100 Continue`'] },
        { id: 'c2xx', label: '2xx', cells: ['200–299', 'Success', '`200 OK`'] },
        { id: 'c3xx', label: '3xx', cells: ['300–399', 'Redirection', '`301 Moved Permanently`'] },
        { id: 'c4xx', label: '4xx', cells: ['400–499', 'Client error', '`404 Not Found`'] },
        { id: 'c5xx', label: '5xx', cells: ['500–599', 'Server error', '`500 Internal Server Error`'] },
      ],
      cites: ['e1'],
      description: 'A table of the five classes of HTTP status code, from 1xx to 5xx, with the range of each, what it means, and one example code.',
    },
  },
  {
    id: 'exchange', kind: 'step_through', title: 'One request, three answers',
    intro: 'Follow a browser asking for a page that has moved.',
    figure: {
      type: 'sequence',
      actors: [{ id: 'browser', label: 'Browser' }, { id: 'server', label: 'Server' }],
      messages: [
        { id: 'req1', from: 'browser', to: 'server', label: 'GET /old-page' },
        { id: 'res1', from: 'server', to: 'browser', label: '301 Moved Permanently' },
        { id: 'req2', from: 'browser', to: 'server', label: 'GET /new-page' },
        { id: 'res2', from: 'server', to: 'browser', label: '200 OK' },
        { id: 'req3', from: 'browser', to: 'server', label: 'GET /missing' },
        { id: 'res3', from: 'server', to: 'browser', label: '404 Not Found' },
      ],
      // 200 is stated in e1: a number a figure shows has to be in a passage the figure itself cites.
      cites: ['e1', 'e2', 'e3'],
      description: 'A browser and a server exchange three requests. The first is answered with 301 and a new location, the second with 200, and the third with 404.',
    },
    steps: [
      { title: 'Ask for the old address', highlight: ['req1'], blocks: [{ type: 'framing', text: 'The browser asks for a page at its old address.' }] },
      { title: 'The server redirects', highlight: ['res1'], blocks: [{ type: 'claim', text: 'A 301 response says the resource has been permanently moved to the URL given in the `Location` header.', cites: ['e3'] }] },
      {
        title: 'Follow the redirect', highlight: ['req2', 'res2'],
        predict: {
          prompt: 'The browser has just received a 301. What does it do next?',
          options: [
            { text: 'It requests the new URL on its own', correct: true, feedback: 'Yes: the browser redirects to the new URL without asking you.' },
            { text: 'It shows an error page', correct: false, feedback: 'A 3xx code is not an error; it tells the browser where to go instead.' },
            { text: 'It asks for the old page again', correct: false, feedback: 'The old address has moved for good, so repeating the request would only get another 301.' },
          ],
        },
        blocks: [{ type: 'claim', text: 'The browser redirects to the new URL, and search engines update their links to the resource.', cites: ['e3'] }],
      },
      { title: 'Ask for something that is not there', highlight: ['req3', 'res3'], blocks: [{ type: 'claim', text: 'A 404 response means the server cannot find the requested resource.', cites: ['e2'] }, { type: 'quote', text: 'often called broken or dead links', cite: 'e2' }] },
    ],
  },
  {
    id: 'check-class', kind: 'checkpoint', title: 'Check: an unfamiliar code', objective: 'o1', level: 'apply',
    question: {
      type: 'single',
      prompt: 'A response comes back with status 418. You have never seen that code. What can you say about it?',
      options: [
        { text: 'It is a client error, because it starts with 4', correct: true, feedback: 'Right: the first digit alone puts it in the 400–499 class.' },
        { text: 'Nothing, until you look the code up', correct: false, feedback: 'You do not need the exact meaning: the first digit already gives the class.', misconception: 'Thinks every code must be memorised individually' },
        { text: 'It is a server error, because it is unusual', correct: false, feedback: 'Server errors start with 5. How rare a code is says nothing about its class.', misconception: 'Associates unfamiliar codes with server faults' },
      ],
      explanation: { text: 'The first digit of the status code defines the class of the response; the last two digits have no categorisation role.', cites: ['e4'] },
    },
  },
  {
    id: 'whose-fault', kind: 'narration', title: 'Who has to change something?',
    blocks: [
      { type: 'claim', text: 'A 4xx code is a client error response: something about the request itself has to change.', cites: ['e1'] },
      { type: 'claim', text: 'A 500 code means the server met an unexpected condition that stopped it from fulfilling the request.', cites: ['e5'] },
      { type: 'claim', text: 'A 503 code means the server is not ready to handle the request, commonly because it is down for maintenance or overloaded.', cites: ['e6'] },
      { type: 'example', text: 'You request `/users/42` and get `404`: check the URL. You request the same URL and get `503`: the URL may be fine, so wait and retry.' },
    ],
  },
  {
    id: 'check-fix', kind: 'checkpoint', title: 'Check: where does the fix belong?', objective: 'o2', level: 'apply',
    question: {
      type: 'single',
      prompt: 'Your app calls an API and gets a 503 on every third request during peak hours. What is the most reasonable first move?',
      options: [
        { text: 'Retry after a short wait, and tell whoever runs the server', correct: true, feedback: 'Yes: a 5xx code points at the server, which here is overloaded.' },
        { text: 'Rewrite the request, since it must be malformed', correct: false, feedback: 'A malformed request would get a 4xx code, and would fail every time.', misconception: 'Treats every failure as a mistake in the request' },
        { text: 'Remove the link, because the resource is gone', correct: false, feedback: 'That would fit a 404. A 503 says the server is not ready right now.', misconception: 'Confuses unavailable with not found' },
      ],
      explanation: { text: 'A 503 indicates the server is not ready to handle the request, commonly because it is overloaded or down for maintenance.', cites: ['e6'] },
      hint: 'Look at the first digit before anything else.',
    },
  },
  {
    id: 'in-code', kind: 'step_through', title: 'The same idea in code',
    figure: {
      type: 'lines', format: 'code', language: 'JavaScript',
      lines: [
        'const res = await fetch("https://api.example.com/users/42");',
        'const klass = Math.floor(res.status / 100);',
        'if (klass === 2) return res.json();',
        'if (klass === 4) throw new Error("fix the request: " + res.status);',
        'if (klass === 5) return retryLater();',
      ],
      description: 'Five lines of JavaScript that fetch a URL, divide the status code by 100 to get its class, and branch on the class.',
    },
    steps: [
      {
        title: 'Get the class',
        highlight: ['l2'],
        blocks: [
          { type: 'claim', text: 'Because the first digit of the status code defines the class, the code needs only that digit to decide what to do.', cites: ['e4'] },
          { type: 'example', text: 'Dividing `res.status` by 100 and rounding down leaves the first digit: 404 becomes 4.' },
        ],
        state: [{ label: 'res.status', value: '404' }, { label: 'klass', value: '4' }],
      },
      { title: 'Branch on the class', highlight: ['l3', 'l4', 'l5'], blocks: [{ type: 'example', text: 'With `res.status` equal to 404, `klass` is 4, so the fourth line runs and reports a problem with the request.' }] },
    ],
  },
  {
    id: 'check-order', kind: 'checkpoint', title: 'Check: the five classes', objective: 'o1', level: 'recall',
    question: {
      type: 'order',
      prompt: 'Put the five classes in order of their first digit, from 1 to 5.',
      items: ['Informational', 'Successful', 'Redirection', 'Client error', 'Server error'],
      explanation: { text: 'Responses are grouped in five classes: informational, successful, redirection, client error and server error.', cites: ['e1'] },
    },
  },
  {
    id: 'recap', kind: 'recap', title: 'What you can do now',
    takeaways: [
      { objective: 'o1', text: 'Read the first digit of a status code to get its class; the other two digits do not change the class.', cites: ['e4'] },
      { objective: 'o2', text: 'Treat 400–499 as a problem with the request and 500–599 as a problem on the server.', cites: ['e1'] },
    ],
    practice: { task: 'Open your browser\'s developer tools on any site, reload, and classify the first ten status codes you see.', lookFor: ['You name the class before reading the description', 'You can say who would have to fix each non-2xx response'] },
    next: [{ topic: 'HTTP methods: GET, POST, PUT and DELETE', why: 'Status codes answer a request; methods are the other half of the conversation.' }],
  },
] as unknown as SceneInput[];

export const HTTP_LESSON: LessonParts = { start, evidence, plan, scenes };
