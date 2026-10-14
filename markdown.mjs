function joinLines(text) {
  let joined = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (joined.endsWith('-') && /[A-Za-z]$/.test(joined.slice(0, -1)) && /^[a-z]/.test(line)) {
      joined = joined.slice(0, -1) + line;
    } else joined += `${joined ? ' ' : ''}${line}`;
  }
  return joined;
}

function listItem(text) {
  return text.replace(/^\s*(?:[•▪◦·→*\-–]|\(?\d{1,3}[.)]|\(?[A-Za-z][.)])\s*/, '').trim();
}

export function blocksToMarkdown(blocks) {
  let footnote = 0, section = 0;
  return blocks.map(block => {
    const lines = block.text.split('\n').map(line => line.trim()).filter(Boolean);
    const text = joinLines(block.text);
    if (!text) return '';
    if (lines.every(line => /^\$[^$]+\$$/.test(line))) {
      return lines.map(line => `$$${line.slice(1, -1)}$$`).join('\n\n');
    }
    switch (block.label) {
      case 'Section-Header': return `${++section === 1 ? '#' : '##'} ${text}`;
      case 'Page-Header': return `> **Page header** · ${text}`;
      case 'Page-Footer': return `> **Page footer** · ${text}`;
      case 'List-Group': return lines.map(line => `- ${listItem(line)}`).join('\n');
      case 'Table': return `| Table |\n| --- |\n${lines.map(line => `| ${line.replaceAll('|', '\\|')} |`).join('\n')}`;
      case 'Caption': return `> *Figure caption — ${text}*`;
      case 'Footnote': return `[^${++footnote}]: ${text}`;
      case 'Table-Of-Contents': return `### Table of contents\n\n${lines.map(line => `- ${line}`).join('\n')}`;
      case 'Form': return `> **Form**\n>\n${lines.map(line => `> ${line}`).join('\n')}`;
      default: return text;
    }
  }).filter(Boolean).join('\n\n');
}

const escapeHtml = text => text.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

let katexPromise;
function loadKatex() {
  katexPromise ||= import('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.mjs')
    .then(module => module.default || module)
    .catch(() => null);
  return katexPromise;
}

function prose(text) {
  return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function inline(text, katex) {
  const parts = text.split(/(\$[^$\n]+\$)/g);
  return parts.map(part => {
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      const source = part.slice(1, -1);
      return katex ? katex.renderToString(source, {throwOnError: false, strict: 'ignore'})
        : `<code class="math-fallback">${escapeHtml(part)}</code>`;
    }
    return prose(part);
  }).join('');
}

function isTable(lines) {
  return lines.length > 1 && /^\|.*\|$/.test(lines[0]) && /^\|[ :|\-]+\|$/.test(lines[1]);
}

export async function renderMarkdown(markdown, container) {
  const katex = await loadKatex();
  container.replaceChildren();
  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim() || /^<!--.*-->$/.test(line.trim())) { index++; continue; }
    let match;
    if ((match = line.match(/^\$\$(.*)\$\$$/))) {
      const math = document.createElement('div'); math.className = 'display-math';
      math.innerHTML = katex ? katex.renderToString(match[1], {displayMode: true, throwOnError: false, strict: 'ignore'})
        : `<code class="math-fallback">${escapeHtml(line)}</code>`;
      container.append(math); index++; continue;
    }
    if ((match = line.match(/^(#{1,6})\s+(.+)$/))) {
      const heading = document.createElement(`h${match[1].length}`);
      heading.innerHTML = inline(match[2], katex); container.append(heading); index++; continue;
    }
    if (line === '---') { container.append(document.createElement('hr')); index++; continue; }
    if ((match = line.match(/^\[\^(\d+)\]:\s*(.*)$/))) {
      const note = document.createElement('p'); note.className = 'footnote';
      note.innerHTML = `<sup>${match[1]}</sup> ${inline(match[2], katex)}`;
      container.append(note); index++; continue;
    }
    if (line.startsWith('>')) {
      const quoteLines = [];
      while (index < lines.length && lines[index].startsWith('>')) quoteLines.push(lines[index++].replace(/^> ?/, ''));
      const quote = document.createElement('blockquote');
      const value = quoteLines.join('\n').trim();
      quote.className = /Figure caption/i.test(value) ? 'caption' : /Page (header|footer)/i.test(value) ? 'document-furniture' : 'callout';
      quote.innerHTML = value.split('\n').map(part => inline(part, katex)).join('<br>');
      container.append(quote); continue;
    }
    if (/^-\s+/.test(line)) {
      const list = document.createElement('ul');
      while (index < lines.length && /^-\s+/.test(lines[index])) {
        const item = document.createElement('li'); item.innerHTML = inline(lines[index++].replace(/^-\s+/, ''), katex); list.append(item);
      }
      container.append(list); continue;
    }
    const possibleTable = lines.slice(index, index + 2);
    if (isTable(possibleTable)) {
      const rows = [];
      while (index < lines.length && /^\|.*\|$/.test(lines[index])) rows.push(lines[index++]);
      const table = document.createElement('table');
      rows.filter((_, row) => row !== 1).forEach((row, rowIndex) => {
        const tr = document.createElement('tr');
        row.slice(1, -1).split(/(?<!\\)\|/).forEach(value => {
          const cell = document.createElement(rowIndex ? 'td' : 'th');
          cell.innerHTML = inline(value.trim().replaceAll('\\|', '|'), katex); tr.append(cell);
        });
        table.append(tr);
      });
      container.append(table); continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s|^>|^-\s|^\[\^\d+\]:|^---$/.test(lines[index])) paragraph.push(lines[index++]);
    const element = document.createElement('p'); element.innerHTML = inline(paragraph.join(' '), katex); container.append(element);
  }
}
