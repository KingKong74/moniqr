import { z } from 'zod';
import type { Email } from '../gmail.js';

/** The model names a message it read; provenance comes from the broker's own cache. */
export const findingToolInput = {
  message_id: z.string().regex(/^[A-Za-z0-9_-]+$/).max(128),
  category: z.enum(['bill', 'commitment', 'reply']),
  summary: z.string().trim().min(1).max(1000),
  evidence: z.string().trim().min(1).max(2000).describe('Exact quote from the message body supporting this finding'),
  deadline_text: z.string().trim().max(300).default('').describe('Exact date/time wording from the body; empty if absent'),
  missing_details: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
};
const toolSchema = z.object(findingToolInput).strict();
const normalise = (text: string) => text.replace(/\s+/g, ' ').trim();

export class EmailObservations {
  private messages = new Map<string, Email>();
  searches = 0;
  messagesRead = 0;
  failures = 0;

  remember(email: Email) {
    this.messagesRead++;
    this.messages.set(email.id, email);
  }

  finding(raw: unknown) {
    const input = toolSchema.parse(raw);
    const source = this.messages.get(input.message_id);
    if (!source) throw new Error('Read this message with read_email before saving a finding.');
    const body = normalise(source.body);
    if (!body.includes(normalise(input.evidence))) throw new Error('Evidence must quote the message body exactly.');
    if (input.deadline_text && !body.includes(normalise(input.deadline_text))) {
      throw new Error('Deadline must quote the source wording. Leave it empty when the source does not state one.');
    }
    return {
      ...input, thread_id: source.threadId, sender: source.from.slice(0, 1000),
      subject: source.subject.slice(0, 1000), received_at: source.date,
    };
  }

  scan(final = false) {
    const attempts = this.searches + this.messagesRead;
    const status = !final ? 'scanning' : attempts === 0 ? 'failed' : this.failures ? 'partial' : 'completed';
    return { status, searches: this.searches, messages_read: this.messagesRead, failures: this.failures };
  }
}
