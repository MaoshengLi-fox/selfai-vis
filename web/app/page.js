import fs from 'node:fs';
import path from 'node:path';
import katex from 'katex';
import TocAside from './TocAside';

const PAPER_ROOT = path.join(process.cwd(), 'SelfAI___NeurIPS_2026');
const MAIN_FILES = ['1-intro.tex', '2-related.tex', '3-methods.tex', '4-exps.tex'];

const AUTHORS = [
  { name: 'Xiao Wu', affils: [1, 2], corresponding: false },
  { name: 'Ting-Zhu Huang', affils: [1], corresponding: true },
  { name: 'Liang-Jian Deng', affils: [1], corresponding: false },
  { name: 'Xiaobing Yu', affils: [5], corresponding: false },
  { name: 'Yu Zhong', affils: [1], corresponding: false },
  { name: 'Shangqi Deng', affils: [3], corresponding: false },
  { name: 'Ufaq Khan', affils: [2], corresponding: false },
  { name: 'Jianghao Wu', affils: [6], corresponding: false },
  { name: 'Xiaofeng Liu', affils: [4], corresponding: false },
  { name: 'Imran Razzak', affils: [2], corresponding: false },
  { name: 'Xiaojun Chang', affils: [2], corresponding: false },
  { name: 'Yutong Xie', affils: [2], corresponding: true }
];

const AFFILIATIONS = [
  { id: 1, name: 'University of Electronic Science and Technology of China' },
  { id: 2, name: 'Mohamed bin Zayed University of Artificial Intelligence' },
  { id: 3, name: 'Xian Jiaotong University' },
  { id: 4, name: 'Yale University' },
  { id: 5, name: 'Washington University in St. Louis' },
  { id: 6, name: 'Monash University' }
];

function renderAuthor(author) {
  return (
    <>
      <span className="author-name">{author.name}</span>
      <sup>{author.affils.join(',')}{author.corresponding ? '*' : ''}</sup>
    </>
  );
}

function readTexFile(fileName) {
  try {
    return fs.readFileSync(path.join(PAPER_ROOT, fileName), 'utf8');
  } catch {
    return '';
  }
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractLatexCommandContent(source, command) {
  const marker = `\\${command}{`;
  const start = source.indexOf(marker);
  if (start < 0) return '';

  let index = start + marker.length;
  let depth = 1;
  let content = '';

  while (index < source.length && depth > 0) {
    const ch = source[index];
    if (ch === '{') {
      depth += 1;
      content += ch;
    } else if (ch === '}') {
      depth -= 1;
      if (depth > 0) content += ch;
    } else {
      content += ch;
    }
    index += 1;
  }

  return content.trim();
}

function cleanLatexTextSegment(raw) {
  return raw
    .replace(/%.*$/gm, '')
    .replace(/\\noindent/g, '')
    .replace(/\\cite[a-zA-Z*]*\{([^}]*)\}/g, (_, keys) => `@@CITE:${keys.split(',').map((k) => k.trim()).join(',')}@@`)
    .replace(/\\ref\{[^}]*\}/g, '')
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/\\url\{([^}]*)\}/g, '$1')
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\textit\{([^}]*)\}/g, '$1')
    .replace(/\\emph\{([^}]*)\}/g, '$1')
    .replace(/\\texttt\{([^}]*)\}/g, '$1')
    .replace(/\\paragraph\{([^}]*)\}/g, '$1:')
    .replace(/\\cmark|\\greencheck|\\checkmark/g, '✓')
    .replace(/\\xmark|\\crosscheck|\\XSolid/g, '✗')
    .replace(/\\tabincell\{[^}]*\}\{([^}]*)\}/g, '$1')
    .replace(/\\blank\{[^}]*\}/g, ' ')
    .replace(/\\_/g, '_')
    .replace(/\\%/g, '%')
    .replace(/\\&/g, '&')
    .replace(/\\/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/~+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLatexInline(raw) {
  return raw
    .split(/(\$[^$\n]+\$)/g)
    .map((part) => {
      if (part.startsWith('$') && part.endsWith('$')) return part;
      return cleanLatexTextSegment(part);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderMath(tex, displayMode) {
  const cleaned = tex
    .replace(/%.*$/gm, '')
    .replace(/\\nonumber/g, '')
    .replace(/\\tag\{[^}]*\}/g, '')
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/^\s*&\s*/gm, '')
    .replace(/’/g, "'")
    .replace(/>=/g, ' \\ge ')
    .replace(/<=/g, ' \\le ')
    .trim();

  if (!cleaned) return '';

  const wrapped = /\\begin\{(?:aligned|matrix|cases|pmatrix|bmatrix|vmatrix)\}/.test(cleaned)
    ? cleaned
    : cleaned.includes('&') || cleaned.includes('\\\\')
      ? `\\begin{aligned}${cleaned}\\end{aligned}`
      : cleaned;

  try {
    return katex.renderToString(wrapped, {
      throwOnError: false,
      displayMode,
      output: 'html',
      strict: 'ignore'
    });
  } catch {
    return `<code>${escapeHtml(cleaned)}</code>`;
  }
}

function renderCitationInline(keysText, citationIndexMap) {
  const keys = keysText.split(',').map((k) => k.trim()).filter(Boolean);
  const numbers = keys
    .map((key) => ({ key, index: citationIndexMap[key] }))
    .filter((item) => Number.isFinite(item.index));

  if (!numbers.length) return `[${escapeHtml(keysText)}]`;
  return `[${numbers.map((item) => `<a class="cite-link" href="#ref-${item.index}">${item.index}</a>`).join(', ')}]`;
}

function renderTextWithCitations(text, citationIndexMap) {
  const citationRegex = /@@CITE:([^@]+?)@@/g;
  let output = '';
  let lastIndex = 0;
  let match;

  while ((match = citationRegex.exec(text)) !== null) {
    output += escapeHtml(text.slice(lastIndex, match.index));
    output += renderCitationInline(match[1], citationIndexMap);
    lastIndex = citationRegex.lastIndex;
  }
  output += escapeHtml(text.slice(lastIndex));

  return output;
}

function renderInlineMath(text, citationIndexMap = {}) {
  return text
    .split(/(\$[^$\n]+\$)/g)
    .map((part) => {
      if (part.startsWith('$') && part.endsWith('$')) {
        return renderMath(part.slice(1, -1).trim(), false);
      }
      return renderTextWithCitations(part, citationIndexMap);
    })
    .join('');
}

function normalizeBibText(raw = '') {
  return raw
    .replace(/[{}]/g, '')
    .replace(/\\&/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFieldValue(input, start) {
  const head = input[start];
  if (head === '{') {
    let index = start + 1;
    let depth = 1;
    let value = '';
    while (index < input.length && depth > 0) {
      const ch = input[index];
      if (ch === '{') {
        depth += 1;
        value += ch;
      } else if (ch === '}') {
        depth -= 1;
        if (depth > 0) value += ch;
      } else {
        value += ch;
      }
      index += 1;
    }
    return { value, next: index };
  }

  if (head === '"') {
    let index = start + 1;
    let value = '';
    while (index < input.length) {
      const ch = input[index];
      if (ch === '"' && input[index - 1] !== '\\') {
        index += 1;
        break;
      }
      value += ch;
      index += 1;
    }
    return { value, next: index };
  }

  let index = start;
  let value = '';
  while (index < input.length && input[index] !== ',' && input[index] !== '\n') {
    value += input[index];
    index += 1;
  }
  return { value, next: index };
}

function parseBibFields(fieldsText) {
  const fields = {};
  let index = 0;

  while (index < fieldsText.length) {
    while (index < fieldsText.length && /[\s,]/.test(fieldsText[index])) index += 1;
    if (index >= fieldsText.length) break;

    let name = '';
    while (index < fieldsText.length && /[A-Za-z0-9_-]/.test(fieldsText[index])) {
      name += fieldsText[index];
      index += 1;
    }
    while (index < fieldsText.length && /\s/.test(fieldsText[index])) index += 1;
    if (fieldsText[index] !== '=') {
      index += 1;
      continue;
    }
    index += 1;
    while (index < fieldsText.length && /\s/.test(fieldsText[index])) index += 1;

    const { value, next } = parseFieldValue(fieldsText, index);
    fields[name.toLowerCase()] = normalizeBibText(value);
    index = next;
  }

  return fields;
}

function parseBibEntries(bibText) {
  const entries = {};
  let index = 0;

  while (index < bibText.length) {
    const at = bibText.indexOf('@', index);
    if (at === -1) break;

    let typeEnd = at + 1;
    while (typeEnd < bibText.length && /[A-Za-z]/.test(bibText[typeEnd])) typeEnd += 1;
    const entryType = bibText.slice(at + 1, typeEnd).toLowerCase();

    while (typeEnd < bibText.length && /\s/.test(bibText[typeEnd])) typeEnd += 1;
    if (bibText[typeEnd] !== '{') {
      index = typeEnd + 1;
      continue;
    }

    let cursor = typeEnd + 1;
    let depth = 1;
    while (cursor < bibText.length && depth > 0) {
      const ch = bibText[cursor];
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      cursor += 1;
    }

    const body = bibText.slice(typeEnd + 1, cursor - 1);
    const commaIndex = body.indexOf(',');
    if (commaIndex > -1) {
      const key = body.slice(0, commaIndex).trim();
      const fieldsText = body.slice(commaIndex + 1);
      entries[key] = {
        key,
        type: entryType,
        fields: parseBibFields(fieldsText)
      };
    }

    index = cursor;
  }

  return entries;
}

function collectCitationKeys(tex) {
  const keys = [];
  const regex = /\\cite[a-zA-Z*]*\{([^}]*)\}/g;
  let match;
  while ((match = regex.exec(tex)) !== null) {
    match[1]
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .forEach((k) => keys.push(k));
  }
  return keys;
}

function formatReference(entry, fallbackKey) {
  if (!entry) return `${fallbackKey}.`;
  const author = entry.fields.author || 'Unknown author';
  const title = entry.fields.title || fallbackKey;
  const venue = entry.fields.journal || entry.fields.booktitle || entry.fields.publisher || '';
  const year = entry.fields.year || '';
  const parts = [author, `"${title}"`, venue, year].filter(Boolean);
  return parts.join('. ') + '.';
}

function parseTabular(tabularSrc) {
  const rows = tabularSrc
    .replace(/%.*$/gm, '')
    .replace(/\\(toprule|midrule|bottomrule|hline)/g, '')
    .replace(/\\cline\{[^}]*\}/g, '')
    .replace(/\\multirow(?:\[[^\]]*\])?\{[^}]*\}\{[^}]*\}\{([^}]*)\}/g, '$1')
    .replace(/\\multicolumn\{[^}]*\}\{[^}]*\}\{([^}]*)\}/g, '$1')
    .split('\\\\')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const protectedRow = row.replace(/\\&/g, '__ESCAPED_AMPERSAND__');
      return protectedRow
        .split('&')
        .map((cell) => cell.replace(/__ESCAPED_AMPERSAND__/g, '\\&'))
        .map((cell) => stripLatexInline(cell));
    });

  if (!rows.length) return null;

  const maxCols = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((row) => {
    const cells = [...row];
    while (cells.length < maxCols) cells.push('');
    return cells;
  });

  return {
    header: normalized[0],
    body: normalized.slice(1)
  };
}

function extractTabularBody(tableEnv) {
  const beginToken = '\\begin{tabular}';
  const endToken = '\\end{tabular}';
  const beginIndex = tableEnv.indexOf(beginToken);
  const endIndex = tableEnv.indexOf(endToken);
  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) return '';

  let cursor = beginIndex + beginToken.length;
  while (cursor < tableEnv.length && /\s/.test(tableEnv[cursor])) cursor += 1;
  if (tableEnv[cursor] !== '{') return '';

  // Skip tabular column spec, including nested braces like @{}...@{}.
  let depth = 1;
  cursor += 1;
  while (cursor < tableEnv.length && depth > 0) {
    const ch = tableEnv[cursor];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    cursor += 1;
  }

  if (depth !== 0) return '';
  return tableEnv.slice(cursor, endIndex);
}

function parseFigure(figureEnv) {
  const imageMatch = figureEnv.match(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/);
  const caption = extractLatexCommandContent(figureEnv, 'caption');

  if (!imageMatch) return null;

  const rawSrc = imageMatch[1].replace(/^\.\//, '').trim();
  const src = rawSrc.endsWith('.pdf')
    ? `/latex/figures_png/${rawSrc.replace(/^figures\//, '').replace(/\.pdf$/i, '.png')}`
    : `/latex/${rawSrc}`;

  return {
    type: 'figure',
    src,
    caption: caption ? stripLatexInline(caption) : ''
  };
}

function parseTable(tableEnv) {
  const caption = extractLatexCommandContent(tableEnv, 'caption');
  const tabularBody = extractTabularBody(tableEnv);
  if (!tabularBody) return null;

  const table = parseTabular(tabularBody);
  if (!table) return null;

  return {
    type: 'table',
    caption: caption ? stripLatexInline(caption) : '',
    ...table
  };
}

function paragraphBlocks(text) {
  const cleaned = text
    .replace(/%.*$/gm, '')
    .replace(/\\section\*?\{[^}]*\}/g, '')
    .replace(/\\subsection\*?\{([^}]*)\}/g, '\n\n__H3__$1\n\n')
    .replace(/\\subsubsection\*?\{([^}]*)\}/g, '\n\n__H4__$1\n\n')
    .replace(/\\begin\{itemize\}|\\end\{itemize\}|\\begin\{enumerate\}|\\end\{enumerate\}/g, '')
    .replace(/\\item/g, '\n• ')
    .trim();

  if (!cleaned) return [];

  return cleaned
    .split(/\n\s*\n/)
    .map((chunk) => stripLatexInline(chunk))
    .filter(Boolean)
    .map((chunk) => {
      if (chunk.startsWith('__H3__')) return { type: 'h3', text: chunk.replace('__H3__', '').trim() };
      if (chunk.startsWith('__H4__')) return { type: 'h4', text: chunk.replace('__H4__', '').trim() };
      if (chunk.startsWith('•')) {
        const items = chunk
          .split('•')
          .map((v) => v.trim())
          .filter(Boolean);
        return { type: 'list', items };
      }
      return { type: 'p', text: chunk };
    });
}

function stripLatexComments(source) {
  return source
    .split('\n')
    .map((line) => {
      const escaped = line.replace(/\\%/g, '__PERCENT__');
      const withoutComment = escaped.replace(/%.*$/, '');
      return withoutComment.replace(/__PERCENT__/g, '\\%');
    })
    .join('\n');
}

function tokenize(tex) {
  const source = stripLatexComments(tex);
  const tokenRegex = /\\begin\{figure\*?\}[\s\S]*?\\end\{figure\*?\}|\\begin\{table\*?\}[\s\S]*?\\end\{table\*?\}|\\begin\{align\*?\}[\s\S]*?\\end\{align\*?\}|\\begin\{equation\*?\}[\s\S]*?\\end\{equation\*?\}|\\\[(?:[\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;
  const blocks = [];
  let last = 0;
  let match;

  while ((match = tokenRegex.exec(source)) !== null) {
    blocks.push(...paragraphBlocks(source.slice(last, match.index)));

    const token = match[0];
    if (token.startsWith('\\begin{figure')) {
      const fig = parseFigure(token);
      if (fig) blocks.push(fig);
    } else if (token.startsWith('\\begin{table')) {
      const table = parseTable(token);
      if (table) blocks.push(table);
    } else {
      const math = token
        .replace(/^\\begin\{align\*?\}|^\\begin\{equation\*?\}/, '')
        .replace(/\\end\{align\*?\}$|\\end\{equation\*?\}$/, '')
        .replace(/^\\\[|\\\]$/g, '')
        .replace(/^\$\$|\$\$$/g, '')
        .trim();
      if (math) blocks.push({ type: 'equation', tex: math });
    }

    last = tokenRegex.lastIndex;
  }

  blocks.push(...paragraphBlocks(source.slice(last)));
  return normalizeTextFlow(blocks);
}

function normalizeTextFlow(blocks) {
  const merged = [];
  let index = 0;

  while (index < blocks.length) {
    const current = blocks[index];
    const next = blocks[index + 1];

    if (
      current?.type === 'p' &&
      next?.type === 'p' &&
      /^(and|or)$/i.test(current.text) &&
      /^where\b/i.test(next.text)
    ) {
      merged.push({ ...next, text: `${current.text} ${next.text}` });
      index += 2;
      continue;
    }

    const nextNext = blocks[index + 2];
    if (
      current?.type === 'p' &&
      next?.type === 'equation' &&
      nextNext?.type === 'p' &&
      /^(and|or)$/i.test(current.text) &&
      /^where\b/i.test(nextNext.text)
    ) {
      merged.push(next);
      merged.push({ ...nextNext, text: `${current.text} ${nextNext.text}` });
      index += 3;
      continue;
    }

    merged.push(current);
    index += 1;
  }

  return merged;
}

function loadPaper() {
  const rootTex = readTexFile('0-neurips_2026.tex');
  const rootTexNoComments = rootTex.replace(/^%.*$/gm, '');
  const bibTex = readTexFile('reference.bib');
  const titleMatch = rootTexNoComments.match(/\\title\{([\s\S]*?)\}/);
  const abstractMatch = rootTex.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
  const conclusionMatch = rootTex.match(/\\section\{Conclusion\}([\s\S]*?)(?:\\bibliographystyle|\\bibliography|\\appendix|$)/);

  const title = titleMatch ? stripLatexInline(titleMatch[1]) : 'SelfAI: A self-directed framework for long-horizon scientific discovery';
  const abstract = abstractMatch ? stripLatexInline(abstractMatch[1]) : '';
  const conclusionText = conclusionMatch ? conclusionMatch[1] : '';

  const sections = [
    {
      id: 'abstract',
      title: 'Abstract',
      blocks: [{ type: 'p', text: abstract }]
    }
  ];
  const citationKeysInOrder = [];
  const seenCites = new Set();

  collectCitationKeys(rootTex).forEach((key) => {
    if (!seenCites.has(key)) {
      seenCites.add(key);
      citationKeysInOrder.push(key);
    }
  });

  MAIN_FILES.forEach((fileName, index) => {
    const tex = readTexFile(fileName);
    if (!tex) return;
    collectCitationKeys(tex).forEach((key) => {
      if (!seenCites.has(key)) {
        seenCites.add(key);
        citationKeysInOrder.push(key);
      }
    });

    const sectionTitleMatch = tex.match(/\\section\{([^}]*)\}/);
    const sectionTitle = sectionTitleMatch ? stripLatexInline(sectionTitleMatch[1]) : `Section ${index + 1}`;

    sections.push({
      id: slugify(`${index + 1}-${sectionTitle}`),
      title: `${index + 1}. ${sectionTitle}`,
      blocks: tokenize(tex)
    });
  });

  if (conclusionText.trim()) {
    sections.push({
      id: 'conclusion',
      title: 'Conclusion',
      blocks: paragraphBlocks(conclusionText)
    });
  }

  const tocItems = [];
  sections.forEach((section) => {
    tocItems.push({ id: section.id, title: section.title, level: 0 });
    let subIndex = 0;
    section.blocks = section.blocks.map((block) => {
      if (block.type !== 'h3') return block;
      subIndex += 1;
      const headingId = `${section.id}-sub-${subIndex}-${slugify(block.text).slice(0, 42)}`;
      tocItems.push({ id: headingId, title: block.text, level: 1 });
      return { ...block, id: headingId };
    });
  });

  const bibEntries = parseBibEntries(bibTex);
  const citationIndexMap = {};
  const references = citationKeysInOrder.map((key, index) => {
    const refNumber = index + 1;
    citationIndexMap[key] = refNumber;
    const entry = bibEntries[key];
    return {
      id: `ref-${refNumber}`,
      index: refNumber,
      key,
      text: formatReference(entry, key),
      url: entry?.fields?.url || ''
    };
  });

  tocItems.push({ id: 'references', title: 'References', level: 0 });

  return {
    title,
    abstract,
    sections,
    tocItems,
    citationIndexMap,
    references
  };
}

export default function HomePage() {
  const paper = loadPaper();

  return (
    <>
      <nav className="nav">
        <a href="#" className="nav-logo">SelfAI</a>
        <div className="nav-r">
          <a href="https://arxiv.org/pdf/2512.00403" className="nav-link" target="_blank" rel="noreferrer">Paper</a>
          <a href="https://github.com/MaoshengLi-fox/selfai-vis.git" className="nav-link" target="_blank" rel="noreferrer">Code</a>
          <a href="/demo" className="gh-pill">Try Demo</a>
        </div>
      </nav>

      <div className="hero-wrap" id="paper">
        <header className="hero">
          <h1>{paper.title}</h1>

          <div className="hero-authors">
            <div className="author-row">
              {AUTHORS.slice(0, 4).map((author, idx) => (
                <span key={author.name}>
                  <span className="author-core">{renderAuthor(author)}</span>
                  {idx < 3 ? <span className="author-sep"> · </span> : null}
                </span>
              ))}
            </div>
            <div className="author-row">
              {AUTHORS.slice(4, 8).map((author, idx) => (
                <span key={author.name}>
                  {renderAuthor(author)}
                  {idx < 3 ? <span className="author-sep"> · </span> : null}
                </span>
              ))}
            </div>
            <div className="author-row">
              {AUTHORS.slice(8).map((author, idx) => (
                <span key={author.name}>
                  {renderAuthor(author)}
                  {idx < 3 ? <span className="author-sep"> · </span> : null}
                </span>
              ))}
            </div>
          </div>

          {AFFILIATIONS.map((aff) => (
            <div className="author-affil" key={aff.id}>
              <sup>{aff.id}</sup> {aff.name}
            </div>
          ))}
          <div className="author-footnote">
            * Corresponding author(s): tingzhuhuang@126.com; yutong.xie@mbzuai.ac.ae
          </div>

          <div className="hero-btns">
            <a className="btn btn-dark" href="https://arxiv.org/pdf/2512.00403" target="_blank" rel="noreferrer">Paper</a>
            <a className="btn btn-mid" href="https://github.com/MaoshengLi-fox/selfai-vis.git" target="_blank" rel="noreferrer">Code</a>
            <a className="btn btn-ghost" href="/demo">Try Demo</a>
          </div>
        </header>

      </div>

      <div className="layout">
        <TocAside items={paper.tocItems} />

        <article className="article">
          {paper.sections.map((section) => (
            <section id={section.id} key={section.id}>
              <h2>{section.title}</h2>

              {section.blocks.map((block, idx) => {
                if (block.type === 'figure') {
                  return (
                    <figure className="fig" key={`${section.id}-fig-${idx}`}>
                      <img src={block.src} alt={block.caption || 'Figure'} loading="lazy" />
                      {block.caption ? <figcaption className="fig-cap" dangerouslySetInnerHTML={{ __html: renderInlineMath(block.caption, paper.citationIndexMap) }} /> : null}
                    </figure>
                  );
                }

                if (block.type === 'table') {
                  const wideTableClass = block.header.length >= 7 ? 'wide-table' : '';
                  return (
                    <figure key={`${section.id}-table-${idx}`}>
                      <div className={`table-wrap ${wideTableClass}`.trim()}>
                        <table>
                          <thead>
                            <tr>
                              {block.header.map((head, headIndex) => (
                                <th key={`h-${headIndex}`} dangerouslySetInnerHTML={{ __html: renderInlineMath(head, paper.citationIndexMap) }} />
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {block.body.map((row, rowIndex) => (
                              <tr key={`r-${rowIndex}`}>
                                {row.map((cell, cellIndex) => (
                                  <td key={`c-${rowIndex}-${cellIndex}`} dangerouslySetInnerHTML={{ __html: renderInlineMath(cell, paper.citationIndexMap) }} />
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {block.caption ? <figcaption className="fig-cap" dangerouslySetInnerHTML={{ __html: renderInlineMath(block.caption, paper.citationIndexMap) }} /> : null}
                    </figure>
                  );
                }

                if (block.type === 'equation') {
                  const html = renderMath(block.tex, true);
                  if (!html) return null;
                  return <div className="equation-block" key={`${section.id}-eq-${idx}`} dangerouslySetInnerHTML={{ __html: html }} />;
                }

                if (block.type === 'h3') {
                  return <h3 id={block.id} key={`${section.id}-h3-${idx}`} dangerouslySetInnerHTML={{ __html: renderInlineMath(block.text, paper.citationIndexMap) }} />;
                }

                if (block.type === 'h4') {
                  return <h4 key={`${section.id}-h4-${idx}`} dangerouslySetInnerHTML={{ __html: renderInlineMath(block.text, paper.citationIndexMap) }} />;
                }

                if (block.type === 'list') {
                  return (
                    <ul key={`${section.id}-list-${idx}`}>
                      {block.items.map((item, itemIndex) => (
                        <li key={`${section.id}-list-item-${itemIndex}`} dangerouslySetInnerHTML={{ __html: renderInlineMath(item, paper.citationIndexMap) }} />
                      ))}
                    </ul>
                  );
                }

                return <p key={`${section.id}-p-${idx}`} dangerouslySetInnerHTML={{ __html: renderInlineMath(block.text, paper.citationIndexMap) }} />;
              })}
            </section>
          ))}

          <section id="references">
            <h2>References</h2>
            <ol className="ref-list">
              {paper.references.map((ref) => (
                <li id={ref.id} key={ref.id}>
                  <span>{ref.text}</span>
                  {ref.url ? (
                    <>
                      {' '}
                      <a href={ref.url} target="_blank" rel="noreferrer">[link]</a>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        </article>
      </div>

      <footer className="footer">
        <p>SelfAI project page rebuilt from NeurIPS 2026 LaTeX source.</p>
      </footer>
    </>
  );
}
