#!/usr/bin/env node
// Stands in for `claude -p` in tests. It starts the MCP servers from --mcp-config
// exactly as Claude Code would, calls write_brief, and prints a JSON result that
// reports what it saw so the test can check the lockdown flags and environment.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const config = JSON.parse(flag('--mcp-config'));
const server = config.mcpServers.agents;

const client = new Client({ name: 'fake-claude', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: server.command, args: server.args, env: server.env }));
const tools = (await client.listTools()).tools.map((t) => t.name);
const call = await client.callTool({
  name: 'write_brief',
  arguments: { body_md: `# Brief\n\n${flag('-p')}`, summary: 'Plumbing works.' },
});
const second = await client.callTool({
  name: 'write_brief',
  arguments: { body_md: 'again', summary: 'again' },
});
await client.close();

console.log(JSON.stringify({
  type: 'result',
  is_error: false,
  num_turns: 2,
  total_cost_usd: 0,
  result: JSON.stringify({
    args,
    cwd: process.cwd(),
    envKeys: Object.keys(process.env).sort(),
    tools,
    first: call.content[0].text,
    second: { isError: second.isError, text: second.content[0].text },
  }),
}));
