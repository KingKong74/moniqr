/**
 * Proposals Bailey carries out himself (level 3 in docs/workforce-permissions.md).
 *
 * - An email reply is a draft. Its recipient and subject come from the saved finding, never from
 *   the agent, and moniqr has no way to send it: Bailey copies it into Gmail himself.
 * - A purchase is a prepared cart: what, where, how much and a link. moniqr has no way to pay:
 *   Bailey buys it himself, after checking the link.
 *
 * Both reuse the approvals table, its revisions, audit trail and expiry. Neither has an executor,
 * so an approval only records that Bailey said yes.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { withTransaction, type Pool } from './db.js';
import { actionView, audit, sourceSnapshot, stableJson, type ActionRow } from './actions.js';
import { ConflictError, NotFoundError } from './runs.js';

/** A purchase proposal can't ask for more than this; a bigger spend is a conversation, not a card. */
export const MAX_PURCHASE_AUD = 5000;
export const MAX_PURCHASES_PER_RUN = 3;
const WEEK_MS = 7 * 86_400_000;

export const replyShape = {
  finding_id: z.number().int().positive().describe('A finding saved in this run; the reply goes to its sender'),
  body: z.string().trim().min(1).max(5000).describe('The reply text only: no subject line, no signature block unless asked'),
  note: z.string().trim().max(1000).default('').describe('One line for Bailey on why this reply, or what to check before sending'),
};
export const replyInput = z.object(replyShape).strict();

const httpsUrl = z.string().trim().max(500).url().refine((u) => {
  try { const url = new URL(u); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}, 'Use a plain https:// link');
export const purchaseShape = {
  item: z.string().trim().min(1).max(200),
  merchant: z.string().trim().min(1).max(100),
  url: httpsUrl.describe('The product page, https only'),
  price: z.number().positive().max(MAX_PURCHASE_AUD).describe('Price per item in AUD, as shown on the page or in the email'),
  quantity: z.number().int().min(1).max(20).default(1),
  reason: z.string().trim().min(1).max(1000).describe('Why Bailey would want this now'),
  finding_id: z.number().int().positive().optional().describe('The finding this came from, if any, saved in this run'),
};
export const purchaseInput = z.object(purchaseShape).strict();

export const proposalRequest = z.discriminatedUnion('kind', [
  replyInput.extend({ kind: z.literal('email_reply') }).strict(),
  purchaseInput.extend({ kind: z.literal('purchase') }).strict(),
]);

const hashOf = (kind: string, title: string, detail: string, payload: unknown, source: unknown) =>
  createHash('sha256').update(stableJson({ kind, title, detail, payload, source, execution_mode: 'record_only' })).digest('hex');

/** The display name from a From line: "Urban Utilities <bills@…>" → "Urban Utilities". */
const senderName = (from: string) => from.replace(/<[^>]*>/, '').replace(/"/g, '').trim() || from;
const replySubject = (subject: string) => (/^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`);

interface Proposer { runId: number; agentId: number; actor: 'ea' | 'agent' }

async function proposer(client: PoolClient, runId: number): Promise<Proposer> {
  const run = (await client.query<{ agent_id: number; role: string }>(
    `SELECT r.agent_id, a.role FROM runs r JOIN agents a ON a.id = r.agent_id WHERE r.id = $1 AND r.status = 'running' FOR UPDATE OF r`,
    [runId])).rows[0];
  if (!run) throw new NotFoundError('Run is no longer running.');
  return { runId, agentId: run.agent_id, actor: run.role === 'worker' ? 'agent' : 'ea' };
}

/** A finding this run saved and Bailey hasn't dismissed. */
async function sourceFinding(client: PoolClient, findingId: number, runId: number) {
  const f = (await client.query('SELECT * FROM email_findings WHERE id = $1 FOR UPDATE', [findingId])).rows[0];
  if (!f) throw new NotFoundError('Source finding not found.');
  if (f.status === 'dismissed') throw new ConflictError('This source finding was dismissed; do not propose for it.');
  if (f.last_run_id !== runId) throw new ConflictError('Save this source finding in the current run before proposing for it.');
  return f;
}

async function insert(client: PoolClient, who: Proposer, kind: string, findingId: number | null, title: string, detail: string,
  payload: unknown, source: unknown, hash: string) {
  const row = (await client.query<ActionRow>(`INSERT INTO approvals
      (run_id, finding_id, kind, title, detail, proposed_action, source_snapshot, payload_hash, expires_at, risk, execution_mode, origin, agent_id)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, 'medium', 'record_only', $10, $11) RETURNING *`,
  [who.runId, findingId, kind, title, detail, JSON.stringify(payload), JSON.stringify(source), hash,
    new Date(Date.now() + WEEK_MS), who.actor === 'agent' ? 'agent' : 'ea', who.agentId])).rows[0]!;
  await audit(client, row, 'proposed', who.actor, who.runId);
  return row;
}

/** Draft a reply to a finding's sender. A later run revises a pending draft; a decided one never reopens. */
export async function proposeReply(pool: Pool, runId: number, input: z.infer<typeof replyInput>) {
  return withTransaction(pool, async (client) => {
    const who = await proposer(client, runId);
    const f = await sourceFinding(client, input.finding_id, runId);
    const source = sourceSnapshot(f);
    const payload = { to: f.sender, subject: replySubject(f.subject), body: input.body, note: input.note };
    const title = `Reply to ${senderName(f.sender)}`.slice(0, 300);
    const detail = (input.note || f.summary).slice(0, 2000);
    const hash = hashOf('email_reply', title, detail, payload, source);
    const old = (await client.query<ActionRow>(`SELECT * FROM approvals WHERE finding_id = $1 AND kind = 'email_reply' FOR UPDATE`, [f.id])).rows[0];
    if (old && (old.status !== 'pending' || old.payload_hash === hash)) return actionView(old, f.status);
    if (!old) return actionView(await insert(client, who, 'email_reply', f.id, title, detail, payload, source, hash), f.status);
    const row = (await client.query<ActionRow>(`UPDATE approvals SET title = $2, detail = $3, proposed_action = $4::jsonb,
        source_snapshot = $5::jsonb, payload_hash = $6, revision = revision + 1, run_id = $7, agent_id = $8, origin = $9,
        expires_at = $10, updated_at = now() WHERE id = $1 RETURNING *`,
    [old.id, title, detail, JSON.stringify(payload), JSON.stringify(source), hash, runId, who.agentId,
      who.actor === 'agent' ? 'agent' : 'ea', new Date(Date.now() + WEEK_MS)])).rows[0]!;
    await audit(client, row, 'revised', who.actor, runId);
    return actionView(row, f.status);
  });
}

/** Suggest something to buy. At most three per run; the same pending item and link is not suggested twice. */
export async function proposePurchase(pool: Pool, runId: number, input: z.infer<typeof purchaseInput>) {
  return withTransaction(pool, async (client) => {
    const who = await proposer(client, runId);
    const f = input.finding_id ? await sourceFinding(client, input.finding_id, runId) : null;
    const count = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM approvals WHERE run_id = $1 AND kind = 'purchase'`, [runId]);
    if (count.rows[0]!.n >= MAX_PURCHASES_PER_RUN) throw new ConflictError(`A run can suggest at most ${MAX_PURCHASES_PER_RUN} purchases.`);
    const dup = (await client.query<ActionRow>(`SELECT * FROM approvals WHERE kind = 'purchase' AND status = 'pending'
      AND proposed_action->>'url' = $1 AND lower(proposed_action->>'item') = lower($2) LIMIT 1`, [input.url, input.item])).rows[0];
    if (dup) return actionView(dup, f?.status);
    const domain = new URL(input.url).hostname.replace(/^www\./, '');
    const total = Math.round(input.price * input.quantity * 100) / 100;
    const payload = { item: input.item, merchant: input.merchant, url: input.url, domain, price: input.price, quantity: input.quantity,
      total, currency: 'AUD', reason: input.reason };
    const source = f ? sourceSnapshot(f) : {};
    const title = `Buy ${input.quantity > 1 ? `${input.quantity} × ` : ''}${input.item}`.slice(0, 300);
    const hash = hashOf('purchase', title, input.reason, payload, source);
    // Purchases may have no finding, so they are not tied to one row per finding like replies are.
    return actionView(await insert(client, who, 'purchase', null, title, input.reason, payload, source, hash), f?.status);
  });
}
