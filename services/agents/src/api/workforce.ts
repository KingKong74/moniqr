import type { Express, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { Pool } from '../db.js';
import { checkRunToken } from '../runs.js';
import { bearer } from '../tokens.js';
import {
  agentInput, agentPatch, changeInput, createAgent, decideChange, delegateInput, getAgent, listAgents, listChanges,
  proposeChange, queueTask, recentReports, reportInput, rosterForEa, taskInput, updateAgent, WORKER_TOOLS, writeReport,
} from '../workforce.js';

const idParam = z.coerce.number().int().positive();
const slugParam = z.string().trim().toLowerCase().max(40);

/**
 * Hub routes manage the workforce directly. Run-token routes are what agents reach through MCP:
 * the EA reads the roster and reports, hands out tasks and asks for changes; a worker files its report.
 */
export function workforceRoutes(app: Express, pool: Pool, hub: RequestHandler) {
  app.get('/workforce', hub, async (_req, res) => {
    const [agents, changes] = await Promise.all([listAgents(pool), listChanges(pool)]);
    res.json({ agents, changes, tools: WORKER_TOOLS });
  });
  app.get('/workforce/changes', hub, async (_req, res) => { res.json({ changes: await listChanges(pool, 'all') }); });
  app.post('/workforce/agents', hub, async (req, res) => {
    res.status(201).json({ agent: await createAgent(pool, agentInput.parse(req.body)) });
  });
  app.get('/workforce/agents/:slug', hub, async (req, res) => {
    res.json(await getAgent(pool, slugParam.parse(req.params.slug)));
  });
  app.patch('/workforce/agents/:slug', hub, async (req, res) => {
    res.json({ agent: await updateAgent(pool, slugParam.parse(req.params.slug), agentPatch.parse(req.body)) });
  });
  app.post('/workforce/agents/:slug/tasks', hub, async (req, res) => {
    const { task } = taskInput.parse(req.body);
    res.status(202).json({ run: await queueTask(pool, slugParam.parse(req.params.slug), task) });
  });
  app.post('/workforce/changes/:id/decision', hub, async (req, res) => {
    const { decision } = z.object({ decision: z.enum(['approved', 'rejected']) }).strict().parse(req.body);
    res.json(await decideChange(pool, idParam.parse(req.params.id), decision));
  });

  // --- Run-token routes ---

  const runAuth = (opts: Parameters<typeof checkRunToken>[3]) => async (req: Request, res: Response, next: () => void) => {
    const id = idParam.parse(req.params.id);
    const token = bearer(req.header('authorization'));
    if (!token || !(await checkRunToken(pool, id, token, opts))) return void res.status(401).json({ error: 'Unauthorised' });
    res.locals.runId = id;
    next();
  };

  // Reads for the EA, including the read-only console. Workers are never given these tools.
  app.get('/runs/:id/agents', runAuth({ tool: 'list_agents' }), async (_req, res) => { res.json(await rosterForEa(pool)); });
  app.get('/runs/:id/agent-reports', runAuth({ tool: 'get_agent_reports' }), async (req, res) => {
    const days = z.coerce.number().int().min(1).max(14).default(3).parse(req.query.days);
    res.json(await recentReports(pool, days));
  });
  // EA writes: refused for the console and for workers.
  app.post('/runs/:id/tasks', runAuth({ write: true }), async (req, res) => {
    const { agent, task } = delegateInput.parse(req.body);
    res.status(202).json({ run: await queueTask(pool, agent, task, res.locals.runId) });
  });
  app.post('/runs/:id/agent-changes', runAuth({ write: true }), async (req, res) => {
    res.status(201).json({ change: await proposeChange(pool, res.locals.runId, changeInput.parse(req.body)) });
  });
  // A worker's only write.
  app.post('/runs/:id/report', runAuth({ worker: true }), async (req, res) => {
    res.status(201).json({ report: await writeReport(pool, res.locals.runId, reportInput.parse(req.body)) });
  });
}
