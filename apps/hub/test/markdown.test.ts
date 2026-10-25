import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from '../src/markdown.js';

test('renders headings, lists and inline styles', () => {
  const html = renderMarkdown('# Today\n\n- **Pay** rego by *Fri*\n- `write_brief` ran\n\n1. First\n2. Second\n\nPlain line\ncontinues');
  assert.equal(
    html,
    [
      '<h3>Today</h3>',
      '<ul>',
      '<li><strong>Pay</strong> rego by <em>Fri</em></li>',
      '<li><code>write_brief</code> ran</li>',
      '</ul>',
      '<ol>',
      '<li>First</li>',
      '<li>Second</li>',
      '</ol>',
      '<p>Plain line continues</p>',
    ].join('\n'),
  );
});

test('escapes HTML and drops link targets from untrusted content', () => {
  const html = renderMarkdown('<script>alert(1)</script> [click](javascript:alert(1)) "<img src=x onerror=y>"');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('click'));
});
