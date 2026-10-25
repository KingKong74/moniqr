/**
 * The agent MCP server. Claude Code starts it over stdio for a single run.
 * It holds no database credentials: every tool calls the agent API with the
 * run's one-off token, which stops working the moment the run ends.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const apiUrl = process.env.AGENTS_API_URL;
const runId = process.env.RUN_ID;
const runToken = process.env.RUN_TOKEN;
if (!apiUrl || !runId || !runToken) {
  console.error('AGENTS_API_URL, RUN_ID and RUN_TOKEN must be set');
  process.exit(1);
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(new URL(path, apiUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${runToken}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const server = new McpServer({ name: 'agents', version: '0.1.0' });

server.registerTool(
  'write_brief',
  {
    title: 'Write brief',
    description:
      "Save this run's brief for Bailey. Call exactly once per run. body_md is the full brief in Markdown; " +
      'summary is at most three short lines and becomes a phone notification.',
    inputSchema: {
      body_md: z.string().min(1).max(20_000).describe('The full brief, in Markdown'),
      summary: z.string().min(1).max(300).describe('Up to three short lines for a push notification'),
    },
  },
  async ({ body_md, summary }) => {
    const res = await post(`/runs/${runId}/brief`, { body_md, summary });
    if (!res.ok) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Brief not saved (${res.status}): ${res.data?.error ?? 'unknown error'}` }],
      };
    }
    return { content: [{ type: 'text', text: `Brief saved (id ${res.data.brief.id}).` }] };
  },
);

await server.connect(new StdioServerTransport());
