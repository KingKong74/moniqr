/**
 * Placeholder content for the HQ page until the agent service stores these things. Everything
 * the page shows that isn't the brief, the runs or the links comes from here, so swapping in
 * real data is a server-side change: replace a field with a query and keep the shape.
 *
 * Calendar events use a day offset from this week's Monday and decimal hours (14.5 = 2:30pm).
 */

export interface MockMail {
  id: string;
  from: string;
  time: string;
  subject: string;
  preview: string;
  body: string;
  facts?: [string, string][];
  /** Set on items that need Bailey's yes or no. */
  approveLabel?: string;
  /** Shows the deals list in the reading pane. */
  deals?: boolean;
  failed?: boolean;
}

export const MOCK = {
  name: 'Bailey',
  upNext: { title: 'Gym · Upper body', note: '09:00 · Anytime Fitness' },

  workforce: [
    { name: 'Health Coach', kind: 'run', state: 'meal plan' },
    { name: 'Concierge', kind: 'wait', state: 'waiting' },
    { name: 'Research Analyst', kind: 'run', state: '1 task' },
    { name: 'Engineering', kind: 'run', state: '3 tasks' },
    { name: 'Reviewer', kind: 'idle', state: 'queued' },
  ],

  slides: [
    {
      kicker: 'For Sam · birthday Thursday',
      title: 'The turntable he mentioned is 20% off until Wednesday.',
      body: 'He brought it up twice in September. Ordering from JB Hi-Fi by tomorrow still arrives Thursday. Moniqr can draft a card message too.',
      primary: { label: 'Add to priorities', priority: 'p4' },
      secondary: { label: 'Draft a card', ask: 'Draft a birthday card message for Sam' },
    },
    {
      kicker: 'Training · week 6 of 8',
      title: 'Upper body today. You are one session from a full week.',
      body: 'Bench is up 7.5kg since week 1. Today: bench 4×6 at 72.5kg, rows, overhead press and pull-ups. Eat the yoghurt snack before your shift to hit protein.',
      primary: { label: 'Start session', habit: 'gym' },
      secondary: { label: 'See program', ask: 'Show my training program' },
    },
    {
      kicker: 'This weekend',
      title: 'Clear skies Sunday morning. Jess asked about a hike.',
      body: 'The Bondi to Coogee walk fits before your weekly review, and Sunday looks like 23° and sunny. You have not replied to her yet.',
      primary: { label: 'Reply to Jess', ask: 'Reply to Jess: yes to Sunday morning' },
      secondary: { label: 'Suggest other ideas', ask: 'Suggest other Sunday plans' },
    },
    {
      kicker: 'Worth a look · from your inbox',
      title: 'Bali return fares from $499, ending Friday.',
      body: 'This matches the March trip you saved. Moniqr checked your leave balance and the dates around your roster; 12 to 19 March works.',
      primary: { label: 'Hold the dates', ask: 'Hold 12-19 March for Bali' },
      secondary: { label: 'Not now', next: true },
    },
  ],

  keyDecision: {
    mailId: 'a1',
    why: 'The table is released at noon and three friends are waiting on it. The grocery order and Google connection can wait until tonight without any cost.',
    deadline: 'Hold expires 12:00 · 4h 48m left',
    steps: ['Proposed by Concierge', 'Your decision', 'Booking table', 'Confirmed · invites sent'],
    completed: 'Table for 4 confirmed · invites sent to Sam, Jess and Tom',
    rejected: 'Concierge will tell the group',
  },

  mail: [
    { id: 'a1', from: 'Concierge', time: '06:58', subject: 'Book Friday dinner for 4 at Chin Chin, 7:30pm?', preview: 'Sam, Jess and Tom said yes. Deposit holds the table until noon.', body: 'Sam, Jess and Tom all said yes in the group chat. Chin Chin has a table for 4 at 7:30pm on Friday. They take a $20 per person deposit to hold it past noon today. I will send calendar invites once it is booked.', facts: [['Cost', '$80 deposit'], ['Hold expires', 'Today 12:00'], ['Guests', 'Sam, Jess, Tom']], approveLabel: 'Book table' },
    { id: 'a2', from: 'Health Coach', time: '06:45', subject: 'Woolworths order for Tuesday delivery', preview: '14 items for this week’s meal plan, $86.40.', body: 'This covers lunches and dinners through Friday and includes chicken breast at half price. Delivery is 6–8pm Tuesday, after you get home. It replaces your usual Wednesday shop.', facts: [['Total', '$86.40'], ['Delivery', 'Tue 6–8pm'], ['Items', '14']], approveLabel: 'Place order' },
    { id: 'a3', from: 'Ops Director', time: '06:41', subject: 'Connect Google so I can read your email and calendar', preview: 'Needed for the deal scan and automatic morning brief.', body: 'The inbox deal scan and the 6:30am brief run automatically once Google is connected. Access is read-only. Nothing is sent from your account without your approval.', facts: [['Access', 'Read-only'], ['Scopes', 'Gmail, Calendar']], approveLabel: 'Connect Google' },
    { id: 'f1', from: 'Moniqr', time: '06:12', subject: '4 deals match your plans', preview: 'Woolworths, JB Hi-Fi, Qantas and Gymshark. 34 others archived.', body: '38 promotional emails arrived since Friday. These four match your meal plan, gift ideas, saved trips or wishlist. The rest were archived.', deals: true },
    { id: 'f2', from: 'Health Coach', time: '05:50', subject: 'Next week’s meal plan is ready', preview: '5 days around 160g protein. Shopping list attached to the order.', body: 'Five days of meals averaging 2,300 kcal and 160g protein, with lighter dinners on shift days. The shopping list is the Woolworths order waiting for your approval.', facts: [['Avg protein', '160g / day'], ['Prep time', '75 min Mon']] },
    { id: 'f3', from: 'Reviewer', time: 'Sun', subject: 'Stack sidebar redesign passed review', preview: '2 minor comments. Ready to merge after tests.', body: 'The sidebar now groups terminals by project and shows the session title on the first line. Two minor comments are left for Builder B. Merge is scheduled once all 18 smoke tests pass.' },
    { id: 'f4', from: 'Deployer', time: 'Sun', subject: 'Inbox automation could not start', preview: 'Google is not connected yet. Nothing was changed.', body: 'The automatic inbox scan could not start because Google is not connected. Approving the Google connection in your inbox will fix this. Nothing was changed.', failed: true },
  ] satisfies MockMail[],
  /** Mail already read when the page loads. */
  readMail: ['f3', 'f4'],

  priorities: [
    { id: 'p1', title: 'Book Friday dinner', note: 'Table released at noon', forgot: false, plan: 'book dinner before 10' },
    { id: 'p2', title: 'Reply to Jess about Sunday', note: 'She asked 2 days ago', forgot: true, plan: 'reply to Jess on your 5pm break' },
    { id: 'p3', title: 'Return the Kmart parcel', note: 'Window closes Wed', forgot: true, plan: 'Kmart return Tuesday after gym' },
    { id: 'p4', title: 'Order Sam’s gift', note: 'Sale ends Wed', forgot: false, plan: 'order Sam’s gift tonight' },
    { id: 'p5', title: 'Pay Tom back $35', note: 'From dinner on 12 Oct', forgot: true, plan: 'transfer Tom $35 now (one tap)' },
  ],

  news: [
    { topic: 'Breaking', title: 'Trackwork on the T1 line this Saturday morning, buses replacing trains', meta: '18 min ago · affects your Sat shift' },
    { topic: 'AI', title: 'Major AI lab releases a new coding model with longer context', meta: '2 h ago' },
    { topic: 'Fitness', title: 'Study links twice-weekly resistance training to better sleep', meta: '5 h ago' },
    { topic: 'Tech', title: 'Earnings preview: services revenue expected to lead this week', meta: '7 h ago' },
  ],
  newsMore: [
    { topic: 'Markets', title: 'ASX opens flat ahead of Wednesday’s CPI print', meta: '3 h ago' },
    { topic: 'Sydney', title: 'New 24-hour gym opening near Central next month', meta: '9 h ago' },
    { topic: 'AI', title: 'Open-source agent frameworks see surge in contributors', meta: 'Yesterday' },
  ],
  interests: [
    { label: 'AI', on: true }, { label: 'Fitness', on: true }, { label: 'Sydney', on: true }, { label: 'Tech', on: true },
    { label: 'Markets', on: true }, { label: 'Football', on: false }, { label: 'Music', on: false }, { label: 'Travel', on: false },
  ],

  moodTrend: [3, 2, 3, 4, 1, 3],
  moodInsight: 'Your mood dips on shift days after short sleep. Moniqr keeps those evenings light.',

  picks: [
    { kind: 'Quote', text: '“We are what we repeatedly do. Excellence, then, is not an act, but a habit.”', sub: 'Will Durant' },
    { kind: 'Small challenge', text: 'Message someone you haven’t spoken to in a month.', sub: 'Tom is a good candidate' },
    { kind: 'Word of the day', text: 'Sonder: the realisation that every passer-by has a life as vivid as your own.', sub: 'Coined by John Koenig' },
    { kind: 'Question to sit with', text: 'What would make this week feel like a win by Sunday night?', sub: 'Bring your answer to the weekly review' },
    { kind: 'Did you know', text: 'A 10-minute walk after a meal can noticeably blunt the blood sugar rise.', sub: 'Easy one before your shift' },
  ],

  glance: { sleep: '7h 12m', sleepPct: 78, sleepNote: '22 min above average', proteinTarget: 160, proteinSoFar: 38, steps: 2140 },

  events: [
    { day: 0, start: 9, hours: 1, title: 'Gym · Upper', kind: 'gym', note: 'Program week 6 · Anytime Fitness' },
    { day: 0, start: 11, hours: 1.5, title: 'Meal prep', kind: 'life', note: 'Lunches Tue–Thu' },
    { day: 0, start: 14, hours: 6, title: 'Woolworths shift', kind: 'work', note: 'Moniqr on quiet mode' },
    { day: 0, start: 20.5, hours: 0.5, title: 'Call Mum', kind: 'life', note: 'She asked about Christmas' },
    { day: 1, start: 7, hours: 1, title: 'Gym · Lower', kind: 'gym', note: 'Squat focus' },
    { day: 1, start: 10, hours: 3, title: 'Stack review', kind: 'life', note: 'Protected focus' },
    { day: 1, start: 18, hours: 2, title: 'Grocery delivery', kind: 'life', note: 'Woolworths order', mailId: 'a2' },
    { day: 2, start: 9, hours: 0.5, title: 'Order Sam’s gift', kind: 'life', note: 'JB Hi-Fi sale ends today' },
    { day: 2, start: 12, hours: 4, title: 'Moniqr launch', kind: 'life', note: 'If Google is connected' },
    { day: 3, start: 7, hours: 1, title: 'Gym · Push', kind: 'gym', note: '' },
    { day: 3, start: 14, hours: 6, title: 'Woolworths shift', kind: 'work', note: '' },
    { day: 4, start: 10, hours: 2, title: 'Personal OS', kind: 'life', note: 'HQ sign-off' },
    { day: 4, start: 19.5, hours: 2.5, title: 'Dinner · Chin Chin', kind: 'life', note: 'Sam, Jess, Tom · deposit $80', mailId: 'a1' },
    { day: 5, start: 8, hours: 6, title: 'Woolworths shift', kind: 'work', note: '' },
    { day: 5, start: 15, hours: 1, title: 'Gym · Pull', kind: 'gym', note: '' },
    { day: 6, start: 8, hours: 4, title: 'Hike with Jess', kind: 'pend', note: 'Needs your reply' },
    { day: 6, start: 19, hours: 1, title: 'Weekly review', kind: 'life', note: 'Moniqr drafts beforehand' },
  ],
  allDay: [{ day: 3, title: 'Sam’s birthday' }],

  habits: [
    { id: 'gym', name: 'Gym', days: [0, 1, 3, 5] },
    { id: 'protein', name: 'Protein 160g', days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'steps', name: '10k steps', days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'read', name: 'Read 20 pages', days: [0, 1, 2, 3, 4] },
    { id: 'screens', name: 'Screens off 22:00', days: [0, 1, 2, 3, 4, 5, 6] },
  ],

  meals: {
    planned: '2,060 kcal planned',
    items: [
      { slot: 'Breakfast', name: 'Oats, whey and banana', macros: '520 kcal · 38g', logged: true },
      { slot: 'Lunch', name: 'Chicken, rice and greens', macros: '680 kcal · 52g', logged: false },
      { slot: 'Pre-shift', name: 'Greek yoghurt and berries', macros: '220 kcal · 20g', logged: false },
      { slot: 'Dinner', name: 'Salmon, potatoes and salad', macros: '640 kcal · 45g', logged: false },
    ],
  },

  people: [
    { when: 'Thu', title: 'Sam’s birthday', note: 'Turntable idea · 20% off until Wed' },
    { when: 'Fri', title: 'Dinner with Sam, Jess and Tom', note: 'Booking is in your inbox' },
    { when: 'Sun', title: 'Jess asked about a hike', note: 'No reply from you yet' },
    { when: '—', title: 'Catch up with Tom', note: '5 weeks since you last met' },
  ],

  deals: [
    { id: 'd1', brand: 'Woolworths', offer: 'Chicken breast half price', why: 'On your meal plan', ends: 'ends Tue' },
    { id: 'd2', brand: 'JB Hi-Fi', offer: '20% off turntables', why: 'Gift idea for Sam', ends: 'ends Wed' },
    { id: 'd3', brand: 'Qantas', offer: 'Bali from $499 return', why: 'Matches your saved March trip', ends: 'ends Fri' },
    { id: 'd4', brand: 'Gymshark', offer: 'Early Black Friday access', why: '2 wishlist items', ends: 'from 3 Nov' },
  ],

  markets: [
    { when: 'Tue 27', title: 'RBA meeting minutes', kind: 'Macro' },
    { when: 'Wed 28', title: 'Microsoft earnings, after US close', kind: 'Earnings' },
    { when: 'Thu 29', title: 'Apple and Amazon earnings, after US close', kind: 'Earnings' },
    { when: 'Thu 29', title: 'Australian quarterly CPI', kind: 'Macro' },
    { when: 'Tue 3', title: 'RBA cash rate decision', kind: 'Macro' },
  ],

  projects: [
    { name: 'Stack', pct: 78, next: 'in review', due: 'Wed 28', warn: false },
    { name: 'Moniqr', pct: 55, next: 'waiting on Google', due: 'Blocked', warn: true },
    { name: 'Personal OS', pct: 20, next: 'HQ v4', due: 'Fri 30', warn: false },
  ],

  /** Shown in the briefing view when the EA hasn't written a brief yet. */
  briefing: {
    title: 'Gym at 9, shift at 2, and Sam’s birthday on Thursday.',
    lede: 'You slept 7h 12m, a little above your average. Today is an upper-body day with meal prep before work. Three decisions are waiting in your inbox, and four promotions line up with things you already have planned.',
    health: 'You have trained 3 of 4 planned sessions this week; today makes 4. Protein has been under target on shift days, so the Health Coach added a Greek yoghurt snack before work. Screens-off after 22:00 slipped twice last week.',
  },

  chat: {
    opening: [
      { me: false, text: 'Morning. Upper body at 9 and meal prep at 11 still fit before your shift. Three decisions are in your inbox; the dinner booking needs an answer by noon.' },
      { me: true, text: 'What should I get Sam?' },
      { me: false, text: 'He mentioned wanting a turntable twice in September. JB Hi-Fi has 20% off until Wednesday, so ordering tomorrow still arrives Thursday.' },
    ],
    suggestions: ['How does my week look?', 'Plan my meals', 'Any good deals?'],
    /** Canned replies, matched on the first keyword found in the message. */
    replies: [
      { match: ['meal'], text: 'Drafted a 5-day plan around 160g protein a day. The grocery order is in your inbox; nothing is bought until you say yes.' },
      { match: ['deal'], text: 'Four worth knowing: chicken half price at Woolworths (ends Tue), 20% off turntables at JB Hi-Fi (ends Wed), Qantas Bali fares from $499 (ends Fri), Gymshark early access from 3 Nov.' },
      { match: ['week'], text: 'Busy but workable: shifts Mon, Thu and Sat, gym Mon, Tue, Thu and Sat, Sam’s birthday Thu, dinner Fri if you book it, hike with Jess Sunday morning.' },
      { match: ['dinner', 'book'], text: 'The table is held until noon. If you would rather go somewhere cheaper, I can ask the group about Rice Paper Sister at 7pm instead.' },
    ],
    fallback: 'Understood. I will draft it and put anything that spends money or messages people in your inbox first.',
  },
};

export type MockData = typeof MOCK;
