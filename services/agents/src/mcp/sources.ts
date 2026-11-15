/**
 * The broker's own record of which sources a run actually read. write_brief appends it to the
 * brief, so freshness and failures are stated by moniqr rather than by the model's say-so.
 */
export type ReadState = { ok: number; failed: number; at?: Date };

export class SourceLedger {
  calendar: ReadState = { ok: 0, failed: 0 };
  admin: ReadState = { ok: 0, failed: 0 };

  record(state: ReadState, ok: boolean, at = new Date()) {
    if (ok) { state.ok++; state.at = at; } else state.failed++;
  }
}

const time = (d: Date) => new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
}).format(d).replace(/,/g, '').replace(/\s?([ap]m)$/i, (_, m: string) => m.toLowerCase());

function line(label: string, s: ReadState, unread: string): string {
  if (!s.ok && !s.failed) return `- ${label}: ${unread}`;
  if (!s.ok) return `- ${label}: **unavailable** (${s.failed} failed ${s.failed === 1 ? 'read' : 'reads'})`;
  const when = s.at ? `read ${time(s.at)}` : 'read';
  return s.failed ? `- ${label}: **partial**, ${when}; ${s.failed} ${s.failed === 1 ? 'read' : 'reads'} failed` : `- ${label}: ${when}`;
}

export interface EmailCoverage { status: string; searches: number; messages_read: number; failures: number }

export function sourcesFooter(ledger: SourceLedger, googleConnected: boolean, email: EmailCoverage | null): string {
  const lines = ['### Sources checked', '_Recorded by moniqr, not written by the assistant._'];
  if (!googleConnected) {
    lines.push('- Calendar and email: not connected');
  } else {
    lines.push(line('Calendar', ledger.calendar, 'not read in this run'));
    if (!email || (!email.searches && !email.messages_read && !email.failures)) lines.push('- Email: not searched in this run');
    else {
      const label = email.status === 'completed' ? '' : email.status === 'partial' ? '**partial**, ' : '**failed**, ';
      lines.push(`- Email: ${label}${email.searches} ${email.searches === 1 ? 'search' : 'searches'}, ` +
        `${email.messages_read} read${email.failures ? `, ${email.failures} failed` : ''}`);
    }
  }
  lines.push(line('Findings and decisions', ledger.admin, 'not read in this run'));
  lines.push('- Finance: not connected');
  return lines.join('\n');
}

/** Appends the footer, trimming the model's text if needed so the brief stays within the API limit. */
export function withFooter(body: string, footer: string, limit = 20_000): string {
  const room = limit - footer.length - 2;
  const trimmed = body.length > room ? `${body.slice(0, Math.max(0, room - 2)).trimEnd()}…` : body.trimEnd();
  return `${trimmed}\n\n${footer}`;
}
