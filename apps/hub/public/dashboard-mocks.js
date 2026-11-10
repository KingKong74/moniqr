// Design fixtures only: no connection to Stack or Finance accounts.
export const projectSamples = [
  { name: 'Moniqr', category: 'Personal OS', status: 'Building', progress: 55, next: 'Finish the Projects and Finance overview', note: 'HQ navigation and dashboard layout are ready to review.', activity: 'Dashboard mockups updated', when: '2 hours ago', attention: 'Needs review' },
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
