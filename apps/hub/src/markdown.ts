/**
 * Renders the small slice of Markdown the EA writes: headings, bullet and numbered lists,
 * paragraphs, bold, italics and inline code. Briefs quote emails and calendar events, so
 * everything is escaped first and links are shown as their text only.
 */

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inline(text: string): string {
  return escape(text)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<em>$2</em>');
}

export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];

  const closePara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join(' ')}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const openList = (kind: 'ul' | 'ol') => {
    closePara();
    if (list !== kind) {
      closeList();
      out.push(`<${kind}>`);
      list = kind;
    }
  };

  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if (!line) {
      closePara();
      closeList();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closePara();
      closeList();
      const level = m[1]!.length <= 2 ? 3 : 4;
      out.push(`<h${level}>${inline(m[2]!)}</h${level}>`);
    } else if ((m = line.match(/^[-*+]\s+(.*)$/))) {
      openList('ul');
      out.push(`<li>${inline(m[1]!)}</li>`);
    } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      openList('ol');
      out.push(`<li>${inline(m[1]!)}</li>`);
    } else {
      closeList();
      para.push(line);
    }
  }
  closePara();
  closeList();
  return out.join('\n');
}

export { escape as escapeHtml };
