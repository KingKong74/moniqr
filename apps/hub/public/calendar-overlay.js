/** Pending proposals are a local layer, never confirmed commitments. Match confirmed
 * writes by provider identity, not titles or approximate times. */
export function calendarLayers(events, actions, showRequests = true, now = Date.now()) {
  const identityMatches = (event, a) => event.id && event.id === a.calendar_event_id &&
    (!event.calendarId || event.calendarId === a.calendar_target_id);
  const base = events.filter(e => !actions.some(a => a.execution_status === 'undone' && identityMatches(e, a)))
    .map(e => {
      const a = actions.find(a => a.execution_status === 'succeeded' && identityMatches(e, a));
      return a ? { ...e, actionId: a.id } : e;
    });
  for (const a of actions) {
    const c = a.proposed_action?.calendar;
    if (a.execution_status === 'succeeded' && c?.start && c.end && a.calendar_event_id &&
      a.executed_at && now - Date.parse(a.executed_at) < 120_000 && !base.some(e => identityMatches(e, a))) {
      base.push({ id: a.calendar_event_id, calendarId: a.calendar_target_id, calendar: 'Main calendar · Created by Moniqr · Syncing',
        title: c.title, start: c.start, end: c.end, location: c.location, allDay: false, actionId: a.id });
    }
  }
  const requests = showRequests ? actions.filter(a => {
    const c = a.proposed_action?.calendar;
    return a.kind === 'calendar_create' && ['pending','approved'].includes(a.status) &&
      !['succeeded','undone','undo_uncertain'].includes(a.execution_status) && c?.start && c.end &&
      !a.proposed_action.missing_details?.length && Number.isFinite(Date.parse(c.start)) && Date.parse(c.end) > Date.parse(c.start);
  }).map(a => ({ title: a.proposed_action.calendar.title, start: a.proposed_action.calendar.start,
    end: a.proposed_action.calendar.end, allDay: false, actionId: a.id, overlay: true,
    calendar: a.execution_status === 'uncertain' ? 'Moniqr · Creation unconfirmed' : a.execution_status === 'failed'
      ? 'Moniqr · Creation failed' : a.execution_mode === 'record_only' && a.status === 'approved' ? 'Moniqr · Fresh review required' : 'Moniqr request · Not confirmed' })) : [];
  return { events: base, requests };
}

/** Pack overlapping events into lanes within their confirmed/request half. */
export function calendarDayLayout(events) {
  const result = new Map(), hasRequests = events.some(e => e.overlay);
  for (const overlay of [false, true]) {
    const sorted = events.filter(e => !!e.overlay === overlay).sort((a,b) => a.start-b.start || b.hours-a.hours);
    let cluster = [], ends = [], clusterEnd = -Infinity;
    const flush = () => {
      const span = hasRequests ? 47 : 98, offset = overlay ? 52 : 1;
      for (const { event, lane } of cluster) result.set(event, { left: offset + lane * span / ends.length, width: Math.max(0.5, span / ends.length - 0.8) });
      cluster = []; ends = []; clusterEnd = -Infinity;
    };
    for (const event of sorted) {
      if (event.start >= clusterEnd && cluster.length) flush();
      let lane = ends.findIndex(end => end <= event.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = event.start + event.hours;
      cluster.push({ event, lane }); clusterEnd = Math.max(clusterEnd, ends[lane]);
    }
    flush();
  }
  return result;
}
