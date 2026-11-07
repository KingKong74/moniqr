// Keep model identities and inference settings; remove native filesystem/tool capabilities.
// Generated from the pinned CLI's own bundled catalog at image build time.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const catalog = JSON.parse(input);
if (!catalog.models?.length) throw new Error('Codex model catalog is empty');
for (const model of catalog.models) {
  model.tool_mode = 'direct';
  model.supports_search_tool = false;
  model.shell_type = 'disabled';
  model.apply_patch_tool_type = null;
  model.experimental_supported_tools = [];
}
process.stdout.write(JSON.stringify(catalog));
