// Design fixtures only: no connection to Stack or Finance accounts.
export const projectSamples = [
  { name: 'Moniqr', category: 'Personal OS', status: 'Building', progress: 55, next: 'Finish the Projects and Finance overview', note: 'Dashboard navigation and layout are ready to review.', activity: 'Dashboard mockups updated', when: '2 hours ago', attention: 'Needs review' },
  { name: 'Stack', category: 'Developer tools', status: 'Live', progress: 78, next: 'Review the next delivery milestone', note: 'Resume context, project boards and activity in one place.', activity: 'Session checkpoint saved', when: 'Yesterday', attention: '' },
  { name: 'Finance', category: 'Personal & business', status: 'Building', progress: 40, next: 'Review transaction categorisation', note: 'Budgets, bank transactions and financial reporting.', activity: 'Budget categories refined', when: '2 days ago', attention: 'Blocked' },
];
export const financeSamples = {
  income: 6400, spent: 2840, budget: 4200, balance: 12480,
  categories: [
    { name: 'Home & bills', spent: 1650, budget: 2200 },
    { name: 'Food & groceries', spent: 520, budget: 650 },
    { name: 'Transport', spent: 280, budget: 450 },
    { name: 'Lifestyle', spent: 390, budget: 900 },
  ],
  transactions: [
    { name: 'Woolworths', category: 'Groceries', date: '9 Nov', amount: -86.40 },
    { name: 'Salary', category: 'Income', date: '8 Nov', amount: 3200 },
    { name: 'Internet', category: 'Utilities', date: '7 Nov', amount: -79 },
    { name: 'Local café', category: 'To categorise', date: '7 Nov', amount: -14.50 },
  ],
  bills: [ { name: 'Rent', due: '12 Nov', amount: 550 }, { name: 'Electricity', due: '16 Nov', amount: 145 }, { name: 'Phone', due: '18 Nov', amount: 49 } ],
};

// Knowledge, Agents and Life are placeholders until each is wired to real data.
export const knowledgeSamples = {
  collections: [
    { name: 'CA study', count: 42, note: 'Module notes, past-paper answers and flashcards', updated: 'Yesterday' },
    { name: 'Work reference', count: 18, note: 'Processes, templates and handover notes', updated: '3 days ago' },
    { name: 'Home and admin', count: 11, note: 'Warranties, insurance and lease documents', updated: 'Last week' },
  ],
  recent: [
    { title: 'Consolidation adjustments, worked example', source: 'CA study', when: '2h ago' },
    { title: 'Car insurance renewal terms', source: 'Home and admin', when: 'Yesterday' },
    { title: 'Month-end close checklist', source: 'Work reference', when: 'Mon' },
    { title: 'Tax deduction rules for study expenses', source: 'CA study', when: 'Sun' },
  ],
  review: [
    { q: 'When is goodwill tested for impairment?', due: 'Today' },
    { q: 'What triggers deferred tax on a revaluation?', due: 'Today' },
    { q: 'Name the three levels of the fair value hierarchy.', due: 'Tomorrow' },
  ],
};

export const lifeSamples = {
  goals: [
    { name: 'Pass CA exam module', progress: 60, note: '6 of 10 topics covered · exam in March' },
    { name: 'Train 4 times a week', progress: 75, note: '3 of 4 sessions this week' },
    { name: 'Save for Japan trip', progress: 40, note: '$2,400 of $6,000' },
  ],
  health: [['Sleep', '7h 12m', 'Last night'], ['Steps', '8,430', 'Today so far'], ['Resting HR', '58 bpm', '7-day average'], ['Training', '3 / 4', 'Sessions this week']],
  people: [
    { name: 'Mum', note: 'Birthday in 9 days. Gift idea saved.' },
    { name: 'Sam', note: 'Dinner Friday. Booking confirmed.' },
    { name: 'Jess', note: 'Haven’t caught up in 3 weeks.' },
  ],
  journal: 'Good week overall. Study is on track but sleep slipped mid-week. Keep Sunday evening free for planning.',
};
