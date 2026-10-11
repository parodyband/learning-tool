// A short history lesson, written the way an agent writes one: dates in claims, in titles and on a
// timeline, a quotation with the source's own punctuation, a numeric question. Synthetic sources.
import type { EvidenceInput, PlanInput } from '../../../src/core/schema';
import type { SceneInput, StartInputRaw } from '../../../src/core/types';
import type { LessonParts } from '../helpers';

const start: StartInputRaw = {
  topic: 'The Apollo 11 Moon landing',
  depth: 'quick',
  learner: { level: 'new', knows: 'Knows people walked on the Moon in the 1960s.', goal: 'Tell the story of the landing in order.' },
};

const evidence: EvidenceInput[] = [
  { url: 'https://space-agency.example.org/missions/apollo-11', title: 'Apollo 11 mission overview', via: 'page' as const,
    excerpt: 'Apollo 11 launched from Cape Kennedy on July 16, 1969, carrying Commander Neil Armstrong, Command Module Pilot Michael Collins and Lunar Module Pilot Edwin “Buzz” Aldrin. An estimated 650 million people watched Armstrong’s televised image and heard his voice describe the event as he took “…one small step for a man, one giant leap for mankind” on July 20, 1969.' },
  { url: 'https://space-agency.example.org/missions/apollo-11/timeline', title: 'Apollo 11 timeline', via: 'page' as const,
    excerpt: 'The lunar module Eagle landed in the Sea of Tranquility at 4:17 p.m. EDT on July 20. Armstrong and Aldrin spent 21 hours, 36 minutes on the lunar surface. The crew splashed down in the Pacific Ocean on July 24, 1969.' },
  { url: 'https://museum.example.com/collections/apollo/goal', title: 'The decision to go to the Moon', via: 'page' as const,
    excerpt: 'On May 25, 1961, President John F. Kennedy announced before Congress the goal of landing a man on the Moon and returning him safely to the Earth before the end of the decade.' },
];

const plan: PlanInput = {
  title: 'Apollo 11: eight days to the Moon and back',
  objectives: [{ id: 'o1', text: 'Put the main events of the Apollo 11 mission in order' }],
  outline: [
    { id: 's1', kind: 'narration', purpose: 'The promise and the launch' },
    { id: 's2', kind: 'narration', purpose: 'The mission as a timeline', figure: 'timeline' },
    { id: 's3', kind: 'checkpoint', purpose: 'Order the events', question: 'order', objective: 'o1' },
    { id: 's4', kind: 'checkpoint', purpose: 'How long on the surface', question: 'numeric', objective: 'o1' },
    { id: 's5', kind: 'recap', purpose: 'Takeaways' },
  ],
};

const scenes = [
  { id: 's1', kind: 'narration', title: 'A promise made in 1961',
    blocks: [
      { type: 'claim', text: 'In May 1961 President Kennedy set the goal of landing a man on the Moon and bringing him back safely before the decade was out.', cites: ['e3'] },
      { type: 'claim', text: 'Apollo 11 launched on July 16, 1969 with three astronauts: Neil Armstrong, Michael Collins and Buzz Aldrin.', cites: ['e1'] },
      { type: 'quote', text: 'one small step for a man, one giant leap for mankind', cite: 'e1' },
      { type: 'framing', text: 'Eight years separate the promise from the footprint. Here is how the last eight days went.' },
    ] },
  { id: 's2', kind: 'narration', title: 'Eight days, four moments',
    blocks: [
      { type: 'claim', text: 'The lunar module Eagle touched down in the Sea of Tranquility on July 20, and the crew splashed down in the Pacific four days later, on July 24.', cites: ['e2'] },
      { type: 'claim', text: 'About 650 million people watched the first steps on television.', cites: ['e1'] },
    ],
    figure: { type: 'timeline',
      events: [
        { id: 'goal', when: 'May 25, 1961', label: 'Kennedy sets the goal', detail: 'A landing before the end of the decade' },
        { id: 'launch', when: 'July 16, 1969', label: 'Launch from Cape Kennedy' },
        { id: 'landing', when: 'July 20, 1969', label: 'Eagle lands', detail: '21 hours, 36 minutes on the surface' },
        { id: 'splash', when: 'July 24, 1969', label: 'Splashdown in the Pacific' },
      ],
      cites: ['e1', 'e2', 'e3'],
      description: 'A timeline of four events: the goal announced in 1961, the launch on July 16, 1969, the landing on July 20 and the splashdown on July 24.',
      caption: 'From the promise to the Pacific.' } },
  { id: 's3', kind: 'checkpoint', title: 'Check: what happened when?', objective: 'o1', level: 'recall',
    question: { type: 'order', prompt: 'Put these events of the Apollo 11 story in order.',
      items: ['Kennedy announces the goal', 'Launch from Cape Kennedy', 'Eagle lands in the Sea of Tranquility', 'Splashdown in the Pacific'],
      explanation: { text: 'The goal was announced in 1961; the mission launched on July 16, 1969, landed on July 20 and splashed down on July 24.', cites: ['e2', 'e3'] } } },
  { id: 's4', kind: 'checkpoint', title: 'Check: time on the Moon', objective: 'o1', level: 'recall',
    question: { type: 'numeric', prompt: 'To the nearest hour, how long did Armstrong and Aldrin spend on the lunar surface?', answer: 22, tolerance: 1, unit: 'hours',
      explanation: { text: 'They spent 21 hours, 36 minutes on the surface, which rounds to 22 hours.', cites: ['e2'] } } },
  { id: 's5', kind: 'recap', title: 'The story in one breath',
    takeaways: [{ objective: 'o1', text: 'Goal in 1961, launch on July 16, 1969, landing on July 20, splashdown on July 24.', cites: ['e1', 'e2', 'e3'] }],
    next: [{ topic: 'Why the Saturn V rocket had three stages', why: 'It explains how the crew got from the launch pad to lunar orbit.' }] },
] as unknown as SceneInput[];

export const APOLLO_LESSON: LessonParts = { start, evidence, plan, scenes };
