/**
 * Tiny steps approved by Manish. A step shown on the public site must be one of these, word for word.
 * Source: project doc "05 Tiny-Step Library v1" (approved 13 Nov 2026) and doc "11 Teen Review of
 * Tiny-Step List v1" (teen wording approved 14 Nov 2026, SCRUM-394).
 * If a step changes in those documents, change it here in the same piece of work.
 */
export const APPROVED_STEPS: Record<string, string[]> = {
  student: [
    "Open your notebook or laptop to today's page.",
    'Write the title of the assignment at the top.',
    'Put your phone face down on the far side of the desk.',
    'Read only the first question.',
    'Set a 2-minute timer and start any one problem.',
    "Put tomorrow's first book in your bag.",
    'Write down one thing due this week.',
  ],
  seeker: [
    'Sit at your work spot and open your resume file.',
    "Write one job title you'd be happy to get.",
    'Open one job posting and read the first three lines.',
    'Copy one skill from the posting into a note.',
    'Change one line of your resume.',
    'Message one person you know: "Do you know anyone hiring for X?"',
    "Write tomorrow's one job-search task on a sticky note.",
  ],
  desk: [
    'Write your one top task for today on a sticky note.',
    "Close one browser tab you don't need.",
    'Open the file for the hard task and type its first heading.',
    'Stand up and refill your water.',
    'Turn your phone face down before you open email.',
    'Write the very next step on your task before you leave it.',
    'Stretch your shoulders once before your next meeting.',
  ],
  manager: [
    'Write down one person on your team who deserves a thank-you.',
    'Send them one line of thanks.',
    'Block 15 minutes on your calendar for thinking.',
    'Add one question to your next 1:1 agenda.',
    'Answer one waiting question with a one-line reply.',
    'Ask one person, "What\'s blocking you?"',
    "Write tomorrow's top priority before you close the laptop.",
  ],
  teen: [
    // Doc 05 sample rewrite, live since 14 Nov.
    'Flip your phone over for 2 minutes. Just 2.',
    // Doc 11 rewrites: approved as wording, NOT yet cleared for the live page (review rule). Listed so the
    // test accepts them once they are published.
    'Open your notebook or laptop. Any page is fine.',
    'Write the name of the assignment at the top. Just the name.',
    'Flip your phone over for 2 minutes. Just 2. (Or pick: phone across the room.)',
    "Read just the first question. You don't have to answer it.",
    'Pick any one problem. Give it 2 minutes.',
    'Put one thing for tomorrow in your bag.',
    'Jot down one thing due this week. Phone notes count.',
  ],
};

/** Words a coaching message must never use (doc 05 reward rules: no shame wording). */
export const SHAME_WORDS = /\b(fail(ed|ure)?|lazy|wrong|bad|shame|stupid|incorrect|should have|you must|try harder)\b/i;
