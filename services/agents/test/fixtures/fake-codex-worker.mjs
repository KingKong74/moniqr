#!/usr/bin/env node
// Stands in for `codex exec` on a worker's task: lists the tools the MCP server offers,
// files a report, tries a second one, and reports what it saw.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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
const report = (summary) => client.callTool({ name: 'write_report', arguments: { body_md: `# Report\n\n${summary}`, summary } });
const first = await report('Found it.');
const second = await report('Again.');
await client.close();
const result = JSON.stringify({
  args: process.argv.slice(2), tools, enabled: server.enabled_tools, mcpEnvKeys: Object.keys(server.env).sort(),
  envKeys: Object.keys(process.env).sort(), first: first.content[0].text, second: { isError: second.isError, text: second.content[0].text },
});
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: result } }));
console.log(JSON.stringify({ type: 'turn.completed', usage: {} }));
