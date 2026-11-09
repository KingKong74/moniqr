import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from '../src/db.js';
import { calendarWriter, CalendarProviderError, eventId, type CalendarWriter, type EventSpec, type ProviderEvent } from '../src/calendar-writer.js';
import { executeCalendarAction } from '../src/calendar-executor.js';
import { calendarWriteCredentialsFromEnv } from '../src/google.js';
import { API_TOKEN, RUNNER_TOKEN, freshDatabase, skipReason, startApp } from './helpers.js';

export class FakeWriter implements CalendarWriter {
  calendarId = 'main@example.com';
  events = new Map<string, ProviderEvent>();
  creates = 0; removes = 0;
  loseReply = false; invisibleInsert = false; refuse = false; failRead = false; loseDelete = false;
  async get(id: string) { if (this.failRead) throw new Error('offline'); return this.events.get(id) ?? null; }
  async create(spec: EventSpec) {
    this.creates++;
    if (this.refuse) throw new CalendarProviderError(403);
    const event = { id: spec.id, etag: 'version1', summary: spec.title, location: spec.location,
      start: { dateTime: spec.start }, end: { dateTime: spec.end }, extendedProperties: { private: spec.tags } };
    if (!this.invisibleInsert) this.events.set(spec.id, event);
    if (this.loseReply || this.invisibleInsert) throw new CalendarProviderError(null);
    return event;
  }
  async remove(event: ProviderEvent) { this.removes++; this.events.delete(event.id); if (this.loseDelete) throw new CalendarProviderError(null); }
}

test('writer credentials are separate and deterministic IDs use the Google base32hex alphabet', () => {
  assert.equal(calendarWriteCredentialsFromEnv({}), null);
  assert.throws(() => calendarWriteCredentialsFromEnv({ GOOGLE_CALENDAR_WRITE_REFRESH_TOKEN: 'write' }));
  assert.deepEqual(calendarWriteCredentialsFromEnv({ GOOGLE_CALENDAR_WRITE_REFRESH_TOKEN: 'write', GOOGLE_REFRESH_TOKEN: 'read', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }),
    { clientId: 'id', clientSecret: 'secret', refreshToken: 'write' });
  assert.match(eventId('instance', 1, 2), /^[a-v0-9]{5,1024}$/);
  assert.notEqual(eventId('instance', 1, 2), eventId('other-installation', 1, 2));
});

test('Google writer has a fixed calendar, no invitations, private tags, and conditional deletion', async () => {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const writer = calendarWriter({ clientId: 'id', clientSecret: 's', refreshToken: 'write' }, 'main@example.com', async (url: any, init?: RequestInit) => {
    calls.push({ url: new URL(String(url)), init });
    if (String(url).includes('oauth2.googleapis')) return Response.json({ access_token: 'access', expires_in: 3600 });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json({ id: 'moniqr123', etag: 'v1' });
  });
  const spec = { id: 'moniqr123', title: 'Shift', start: '2027-01-01T09:00:00+10:00', end: '2027-01-01T10:00:00+10:00', location: '', tags: { moniqrAction: '1' } };
  await writer.create(spec); await writer.remove({ id: spec.id, etag: 'v1' });
  const insertion = calls.find(c => c.init?.method === 'POST' && c.url.hostname === 'www.googleapis.com')!;
  assert.equal(insertion.url.pathname, '/calendar/v3/calendars/main%40example.com/events');
  assert.equal(insertion.url.searchParams.get('sendUpdates'), 'none');
  const payload = JSON.parse(String(insertion.init?.body));
  assert.equal(payload.attendees, undefined); assert.equal(payload.recurrence, undefined);
  assert.deepEqual(payload.extendedProperties.private, spec.tags);
  assert.equal(payload.visibility, 'private');
  const deletion = calls.find(c => c.init?.method === 'DELETE')!;
  assert.equal((deletion.init?.headers as Record<string,string>)['if-match'], 'v1');
  await assert.rejects(writer.remove({ id: spec.id }), /no event version/);
});

describe('calendar execution and undo', { skip: skipReason }, () => {
  let pool: Pool, drop: () => Promise<void>, api: Awaited<ReturnType<typeof startApp>>;
  let readonly: Awaited<ReturnType<typeof startApp>>;
  let run: any; let sequence = 0;
  const writer = new FakeWriter();
  const timed = () => {
    const start = new Date(Date.now()+2*86400000+10*3600000).toISOString().replace('Z','+10:00');
    const end = new Date(Date.parse(start)+3600000+10*3600000).toISOString().replace('Z','+10:00');
    return { title: 'Reviewed shift', start, end, timeZone: 'Australia/Brisbane', location: 'Store' };
  };
  async function proposal(targetApi = api) {
    const f = (await api.call('POST', `/runs/${run.run.id}/findings`, run.runToken, {
      message_id: `message${++sequence}`,thread_id:'thread1',category:'commitment',sender:'Roster',subject:'Shift',received_at:'2026-11-09T09:00:00+10:00',summary:'Shift',evidence:'Your shift.',deadline_text:'',missing_details:[],
    })).body.finding;
    const r = await targetApi.call('POST', `/runs/${run.run.id}/actions`, run.runToken, { finding_id:f.id,kind:'calendar_create',title:'Review shift',detail:'From roster',calendar:timed() });
    assert.equal(r.status,201);return r.body.action;
  }
  const approve = (a: any) => api.call('POST', `/actions/${a.id}/decision`, API_TOKEN, { decision:'approved',revision:a.revision });
  const operation = (a: any, op: string) => api.call('POST', `/actions/${a.id}/${op}`, API_TOKEN, { revision:a.revision });
  before(async()=>{
    ({pool,drop}=await freshDatabase()); api=await startApp(pool,60000,writer.calendarId,writer); readonly=await startApp(pool,60000,writer.calendarId);
    await api.call('POST','/agents/ea/run',API_TOKEN,{kind:'morning_brief'});run=(await api.call('POST','/runner/claim',RUNNER_TOKEN)).body;
  });
  after(async()=>{await api.close();await readonly.close();await drop();});
  test('concurrent owner approvals create one event and preserve audit evidence',async()=>{
    const a=await proposal();const before=writer.creates;
    const results=await Promise.all(Array.from({length:4},()=>approve(a)));
    for(const r of results){assert.equal(r.status,200);assert.equal(r.body.action.execution_status,'succeeded');}
    assert.equal(writer.creates-before,1);assert.equal(writer.events.size,1);
    const detail=(await api.call('GET',`/actions/${a.id}`,API_TOKEN)).body;
    assert.equal(detail.events.filter((e:any)=>e.event_type==='execution_started').length,1);
    assert.equal((await operation(a,'undo')).body.action.execution_status,'undone');
    const deletes=writer.removes;assert.equal((await operation(a,'undo')).body.action.execution_status,'undone');assert.equal(writer.removes,deletes);
  });
  test('a lost insert reply is reconciled by the stable provider ID',async()=>{
    const a=await proposal();writer.loseReply=true;const before=writer.creates;
    const r=await approve(a);writer.loseReply=false;
    assert.equal(r.body.action.execution_status,'succeeded');assert.equal(writer.creates-before,1);
    assert.equal((await operation(a,'execute')).body.action.execution_status,'succeeded');assert.equal(writer.creates-before,1);
  });
  test('an uncertain invisible insert is never blindly reinserted',async()=>{
    const a=await proposal();writer.invisibleInsert=true;const before=writer.creates;
    const r=await approve(a);writer.invisibleInsert=false;
    assert.equal(r.body.action.execution_status,'uncertain');
    assert.equal((await operation(a,'execute')).body.action.execution_status,'uncertain');assert.equal(writer.creates-before,1);
    assert.equal((await operation(a,'undo')).status,409);
  });
  test('old record-only approvals require explicit preparation and a fresh decision',async()=>{
    const a=await proposal(readonly);const before=writer.creates;
    assert.equal((await approve(a)).body.action.execution_mode,'record_only');assert.equal(writer.creates,before);
    assert.equal((await operation(a,'execute')).status,409);
    const p=await operation(a,'prepare');assert.equal(p.status,200);const next=p.body.action;
    assert.equal(next.revision,a.revision+1);assert.equal(next.status,'pending');
    assert.equal((await approve(a)).status,409);assert.equal(writer.creates,before);
    assert.equal((await approve(next)).body.action.execution_status,'succeeded');assert.equal(writer.creates,before+1);
  });
  test('source changes, dismissed findings, expiry and rejected proposals cannot create events',async()=>{
    const before=writer.creates;
    for(const change of ['source','dismiss','expiry','reject']){
      const a=await proposal();
      if(change==='source')await pool.query("UPDATE email_findings SET evidence='Changed source' WHERE id=$1",[a.finding_id]);
      if(change==='dismiss')await api.call('PATCH',`/findings/${a.finding_id}`,API_TOKEN,{status:'dismissed'});
      if(change==='expiry')await pool.query("UPDATE approvals SET expires_at=now()-interval '1 second' WHERE id=$1",[a.id]);
      if(change==='reject')await api.call('POST',`/actions/${a.id}/decision`,API_TOKEN,{decision:'rejected',revision:a.revision});
      const r=await approve(a);assert.ok(r.status===409||r.body.action.execution_status==='failed');
    }
    assert.equal(writer.creates,before);
  });
  test('ownership tags and changed Google content protect unrelated events from undo',async()=>{
    const a=await proposal();const result=(await approve(a)).body.action;const event=writer.events.get(result.calendar_event_id)!;
    writer.events.set(event.id,{...event,extendedProperties:{private:{}}});const before=writer.removes;
    assert.equal((await operation(a,'undo')).body.action.execution_status,'undo_uncertain');assert.equal(writer.removes,before);
    writer.events.set(event.id,{...event,summary:'Edited in Google'});
    assert.equal((await operation(a,'undo')).body.action.execution_status,'undo_uncertain');assert.equal(writer.removes,before);
    writer.events.set(event.id,event);writer.loseDelete=true;
    assert.equal((await operation(a,'undo')).body.action.execution_status,'undo_uncertain');writer.loseDelete=false;
    assert.equal((await operation(a,'undo')).body.action.execution_status,'undone');
  });
  test('missing Google permission fails visibly, permits safe retry, and run tokens cannot execute',async()=>{
    const a=await proposal();writer.refuse=true;
    assert.equal((await approve(a)).body.action.execution_status,'failed');writer.refuse=false;
    assert.equal((await api.call('POST',`/actions/${a.id}/execute`,run.runToken,{revision:a.revision})).status,401);
    assert.equal((await operation(a,'execute')).body.action.execution_status,'succeeded');
    assert.equal((await readonly.call('POST',`/actions/${a.id}/undo`,API_TOKEN,{revision:a.revision})).status,409);
    await assert.rejects(executeCalendarAction(pool,{...writer,calendarId:'other-calendar'} as any,a.id,a.revision),/target calendar changed/);
  });
});
