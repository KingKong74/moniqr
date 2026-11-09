import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore Public ES module is also used directly by the browser.
import { calendarLayers, calendarDayLayout } from '../public/calendar-overlay.js';

const action = { id:1,kind:'calendar_create',status:'pending',execution_status:'not_requested',execution_mode:'record_only',
  proposed_action:{calendar:{title:'Shift',start:'2027-01-01T09:00:00+10:00',end:'2027-01-01T10:00:00+10:00'},missing_details:[]} };
test('only timed unresolved requests enter the local overlay',()=>{
  assert.equal(calendarLayers([], [action]).requests.length,1);
  assert.equal(calendarLayers([], [action],false).requests.length,0);
  for(const status of ['rejected','expired'])assert.equal(calendarLayers([],[{...action,status}]).requests.length,0);
  assert.equal(calendarLayers([],[{...action,kind:'manual'}]).requests.length,0);
  assert.equal(calendarLayers([],[{...action,proposed_action:{calendar:{title:'Unknown'},missing_details:[]}}]).requests.length,0);
  assert.equal(calendarLayers([],[{...action,proposed_action:{...action.proposed_action,missing_details:['Unclear date']}}]).requests.length,0);
});
test('confirmed events reconcile by calendar and provider ID, and undo removes stale cached events',()=>{
  const created={...action,status:'approved',execution_status:'succeeded',calendar_event_id:'provider1',calendar_target_id:'main',executed_at:new Date().toISOString()};
  const event={id:'provider1',calendarId:'main',title:'Shift',start:action.proposed_action.calendar.start,end:action.proposed_action.calendar.end};
  const real=calendarLayers([event],[created]);assert.equal(real.events.length,1);assert.equal(real.requests.length,0);assert.equal(real.events[0].actionId,1);
  assert.equal(calendarLayers([],[created]).events.length,1,'confirmed event appears while read feed refreshes');
  assert.equal(calendarLayers([],[created],true,Date.now()+180000).events.length,0,'never perpetuate a deleted or missing Google event');
  assert.equal(calendarLayers([event],[{...created,execution_status:'undone'}]).events.length,0);
  assert.equal(calendarLayers([{...event,calendarId:'other'}],[created]).events.length,2,'different calendars must not be deduplicated');
});

test('requests span the full day column without narrowing confirmed events',()=>{
  const real={start:9,hours:2,overlay:false},a={start:9,hours:2,overlay:true},b={start:10,hours:1,overlay:true};
  const layout=calendarDayLayout([real,a,b]);
  assert.deepEqual(layout.get(a),{left:1,width:98});
  assert.deepEqual(layout.get(b),{left:1,width:98});
  assert.ok(layout.get(real).width>95);
});
