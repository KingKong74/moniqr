#!/usr/bin/env node
// Stands in for `codex exec` in tests. It starts the configured MCP server,
// calls write_brief, and prints JSONL events with a result that
// reports what it saw so the test can check the lockdown flags and environment.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const args = process.argv.slice(2);
const config = readFileSync(path.join(process.env.CODEX_HOME, 'config.toml'), 'utf8');
const sections = {};
let section = '';
for (const line of config.split('\n')) {
  if (line.startsWith('[')) { section = line.slice(1, -1); sections[section] = {}; }
  else if (section && line.includes(' = ')) {
    const [key, ...rest] = line.split(' = ');
    try { sections[section][key] = JSON.parse(rest.join(' = ')); } catch {}
  }
}
const server = { ...sections['mcp_servers.agents'], env: sections['mcp_servers.agents.env'] };

const client = new Client({ name: 'fake-codex', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: server.command, args: server.args, env: server.env }));
const tools = (await client.listTools()).tools.map((t) => t.name);
const proposals = await client.callTool({ name: 'list_action_proposals', arguments: {} });
const invented = tools.includes('propose_action') ? await client.callTool({ name: 'propose_action', arguments: {
  finding_id: 999999, kind: 'manual', title: 'Invented', detail: 'Invented', instructions: 'Do something',
} }) : null;
const call = await client.callTool({
  name: 'write_brief',
  arguments: { body_md: `# Brief\n\n${args.at(-1)}`, summary: 'Plumbing works.' },
});
const second = await client.callTool({
  name: 'write_brief',
  arguments: { body_md: 'again', summary: 'again' },
});
await client.close();

const result = JSON.stringify({
  args, cwd: process.cwd(), envKeys: Object.keys(process.env).sort(), tools,
  proposals: { isError: proposals.isError ?? false, text: proposals.content[0].text },
  invented: invented ? { isError: invented.isError, text: invented.content[0].text } : null,
  first: call.content[0].text,
  second: { isError: second.isError, text: second.content[0].text },
});
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: result } }));
console.log(JSON.stringify({ type: 'turn.completed', usage: {} }));
