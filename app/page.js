import katex from 'katex';
import { TEX_SOURCES } from './latexContent';

const TEX_FILES = [
  { file: '1-intro.tex', title: '1 Introduction' },
  { file: '2-related.tex', title: '2 Related Work' },
  { file: '3-methods.tex', title: '3 Methods' },
  { file: '4-exps.tex', title: '4 Experiments' }
];

function slugify(input) {
  return input.toLowerCase().replace(/[^a-z0-9\s.-]/g, '').trim().replace(/[\s.]+/g, '-');
}

function stripLatexInline(raw) {
  return raw
    .replace(/%.*$/gm, '')
    .replace(/\\noindent/g, '')
    .replace(/\\cite\{[^}]*\}/g, '')
    .replace(/\\ref\{[^}]*\}/g, '')
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/\\url\{([^}]*)\}/g, '$1')
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\textit\{([^}]*)\}/g, '$1')
    .replace(/\\emph\{([^}]*)\}/g, '$1')
    .replace(/\\paragraph\{([^}]*)\}/g, '$1:')
    .replace(/\\cmark|\\greencheck|\\checkmark/g, '✓')
    .replace(/\\xmark|\\crosscheck|\\XSolid/g, '✗')
    .replace(/\\tabincell\{[^}]*\}\{([^}]*)\}/g, '$1')
    .replace(/\\blank\{[^}]*\}/g, ' ')
    .replace(/\\\\/g, ' / ')
    .replace(/~+/g, ' ')
    .replace(/\\%/g, '%')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderMath(tex, displayMode) {
  const cleaned = tex
    .replace(/%.*$/gm, '')
    .replace(/\\nonumber/g, '')
    .replace(/\\tag\{[^}]*\}/g, '')
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/\\text([A-Za-z]+)/g, '\\text{$1}')
    .replace(/>=/g, ' \\ge ')
    .replace(/<=/g, ' \\le ')
    .replace(/^\s*&\s*/gm, '')
    .trim();
  if (!cleaned) return '';
  const wrapped = /\\begin\{aligned\}|\\begin\{matrix\}|\\begin\{cases\}/.test(cleaned)
    ? cleaned
    : cleaned.includes('&') || cleaned.includes('\\\\')
      ? `\\begin{aligned}${cleaned}\\end{aligned}`
      : cleaned;
  try {
    return katex.renderToString(wrapped, { throwOnError: false, displayMode, output: 'html', strict: 'ignore' });
  } catch {
    return `<code>${cleaned}</code>`;
  }
}

function renderInlineMath(text) {
  return text
    .split(/(\$[^$\n]+\$)/g)
    .map((part) => {
      if (part.startsWith('$') && part.endsWith('$')) return renderMath(part.slice(1, -1).trim(), false);
      return part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    })
    .join('');
}

function parseTabular(tabularSrc) {
  const normalized = tabularSrc
    .replace(/%.*$/gm, '')
    .replace(/\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/g, (_, inner) =>
      inner.replace(/\\\\/g, ' / ').replace(/\s+/g, ' ').trim()
    )
    .replace(/\\tabincell\{[^}]*\}\{([^}]*)\}/g, (_, inner) => inner.replace(/\\\\/g, ' / '))
    .replace(/\\multirow(?:\[[^\]]*\])?\{[^}]*\}\{[^}]*\}\{([^}]*)\}/g, '$1')
    .replace(/\\multicolumn\{[^}]*\}\{[^}]*\}\{([^}]*)\}/g, '$1')
    .replace(/^[lcrmbpX|@{}\s0-9.]+(?=(\\textbf\{)?(Category|Solver)\b)/i, '');

  const lines = normalized
    .replace(/\\(toprule|midrule|bottomrule|hline)/g, '')
    .replace(/\\cline\{[^}]*\}/g, '')
    .split('\\\\')
    .map((r) => r.trim())
    .filter(Boolean);

  const rows = lines
    .map((row) => row.split('&').map((cell) => stripLatexInline(cell).trim()))
    .filter((r) => r.some(Boolean));

  if (!rows.length) return null;
  const maxCols = Math.max(...rows.map((r) => r.length));
  const normalizedRows = rows.map((r) => {
    const next = [...r];
    while (next.length < maxCols) next.push('');
    return next;
  });
  return { header: normalizedRows[0], body: normalizedRows.slice(1) };
}

function parseFigure(env) {
  const imgMatch = env.match(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/);
  const capMatch = env.match(/\\caption\{([\s\S]*?)\}/);
  if (!imgMatch) return null;
  const rawSrc = imgMatch[1].replace(/^\.\//, '').trim();
  const src = rawSrc.endsWith('.pdf')
    ? `/latex/figures_png/${rawSrc.replace(/^figures\//, '').replace(/\.pdf$/i, '.png')}`
    : `/latex/${rawSrc}`;
  return { type: 'figure', src, caption: capMatch ? stripLatexInline(capMatch[1]).replace(/[{}]/g, '') : '' };
}

function parseTable(env) {
  const capMatch = env.match(/\\caption\{([\s\S]*?)\}/);
  const tabularMatch = env.match(/\\begin\{tabular\}[\s\S]*?\{[\s\S]*?\}([\s\S]*?)\\end\{tabular\}/);
  if (!tabularMatch) return null;
  const table = parseTabular(tabularMatch[1]);
  if (!table) return null;
  return { type: 'table', caption: capMatch ? stripLatexInline(capMatch[1]).replace(/[{}]/g, '') : '', ...table };
}

function paragraphBlocks(text) {
  const cleaned = text
    .replace(/\\section\*?\{[^}]*\}/g, '')
    .replace(/\\subsection\*?\{[^}]*\}/g, '')
    .replace(/\\subsubsection\*?\{[^}]*\}/g, '')
    .replace(/\\begin\{[^}]*\}|\\end\{[^}]*\}/g, '')
    .replace(/\\item/g, '• ')
    .replace(/%.*$/gm, '')
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\n\s*\n/)
    .map((p) => stripLatexInline(p).trim())
    .filter((p) => !/^\s*(References|Bibliography)\s*$/i.test(p))
    .filter((p) => !/^\\bibliographystyle|^\\bibliography/.test(p))
    .filter(Boolean)
    .map((txt) => ({ type: 'p', text: txt }));
}

function tokenize(tex) {
  const tokenRegex = /\\begin\{figure\*?\}[\s\S]*?\\end\{figure\*?\}|\\begin\{table\*?\}[\s\S]*?\\end\{table\*?\}|\\begin\{align\*?\}[\s\S]*?\\end\{align\*?\}|\\begin\{equation\*?\}[\s\S]*?\\end\{equation\*?\}|\\\[(?:[\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;
  const blocks = [];
  let last = 0;
  let m;
  while ((m = tokenRegex.exec(tex)) !== null) {
    blocks.push(...paragraphBlocks(tex.slice(last, m.index)));
    const token = m[0];
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
      const plain = math.replace(/[{}\\_^&=<>|()[\]0-9+\-*/.,:;]/g, '').trim();
      if (math && plain.toLowerCase() !== 'and') blocks.push({ type: 'equation', tex: math });
    }
    last = tokenRegex.lastIndex;
  }
  blocks.push(...paragraphBlocks(tex.slice(last)));
  return blocks;
}

function loadSections() {
  const root = TEX_SOURCES['0-neurips_2026.tex'] || '';
  const m = root.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
  const abstract = m ? stripLatexInline(m[1]) : '';
  const sections = [{ id: 'abstract', title: 'Abstract', blocks: [{ type: 'p', text: abstract }] }];
  for (const item of TEX_FILES) {
    const tex = TEX_SOURCES[item.file] || '';
    sections.push({ id: slugify(item.title), title: item.title, blocks: tokenize(tex) });
  }
  return sections;
}

export default function HomePage() {
  const sections = loadSections();
  return (
    <>
      <nav className="nav">
        <a href="#" className="nav-logo">SELFAI</a>
        <div className="nav-r">
          <a href="#article" className="nav-link">Docs</a>
          <a href="#article" className="nav-link" style={{ color: 'var(--t1)' }}>Blog</a>
          <a href="/demo" className="gh-pill">Try Demo</a>
        </div>
      </nav>

      <div className="hero-wrap">
        <section className="hero">
          <h1>SelfAI: A self-directed framework for long-horizon scientific discovery</h1>
          <div className="hero-date">arXiv:2512.00403v2</div>
          <div className="hero-authors">
            <div className="author-row">
              <span className="author-name author-core">Xiao Wu</span><span className="author-sep"> · </span>
              <span className="author-name author-core">Ting-Zhu Huang</span><span className="author-sep"> · </span>
              <span className="author-name author-core">Liang-Jian Deng</span><span className="author-sep"> · </span>
              <span className="author-name author-core">Xiaobing Yu</span>
            </div>
            <div className="author-row">
              <span className="author-name">Yu Zhong</span><span className="author-sep"> · </span>
              <span className="author-name">Shangqi Deng</span><span className="author-sep"> · </span>
              <span className="author-name">Ufaq Khan</span><span className="author-sep"> · </span>
              <span className="author-name">Jianghao Wu</span>
            </div>
            <div className="author-row">
              <span className="author-name">Xiaofeng Liu</span><span className="author-sep"> · </span>
              <span className="author-name">Imran Razzak</span><span className="author-sep"> · </span>
              <span className="author-name">Xiaojun Chang</span><span className="author-sep"> · </span>
              <span className="author-name">Yutong Xie</span>
            </div>
          </div>
          <div className="author-affil">
            University of Electronic Science and Technology of China · MBZUAI · Xian Jiaotong University
          </div>
          <div className="author-affil">
            Yale University · Washington University in St. Louis · Monash University
          </div>
          <div className="hero-btns">
            <a className="btn btn-dark" href="/papers/2512.00403v2.pdf" target="_blank" rel="noreferrer">Paper</a>
            <a className="btn btn-mid" href="/papers/2512.00403v2.pdf" download>Code</a>
            <a className="btn btn-ghost" href="/demo">Try Demo</a>
          </div>
        </section>
      </div>

      <div className="layout" id="article">
        <aside className="toc visible">
          <div className="toc-label">ON THIS PAGE</div>
          {sections.map((section) => (
            <a key={section.id} href={`#${section.id}`}>{section.title}</a>
          ))}
        </aside>

        <article className="article">
          {sections.map((section) => (
            <section id={section.id} key={section.id}>
              <h2>{section.title}</h2>
              {section.blocks.map((block, idx) => {
                if (block.type === 'figure') {
                  return (
                    <figure className="fig" key={`${section.id}-f-${idx}`}>
                      <img src={block.src} alt={block.caption || 'Figure'} loading="lazy" style={{ width: '100%', borderRadius: '10px' }} />
                      {block.caption ? <figcaption className="fig-cap">{block.caption}</figcaption> : null}
                    </figure>
                  );
                }
                if (block.type === 'equation') {
                  const html = renderMath(block.tex, true);
                  if (!html) return null;
                  return <div className="equation-block" key={`${section.id}-e-${idx}`} dangerouslySetInnerHTML={{ __html: html }} />;
                }
                if (block.type === 'table') {
                  return (
                    <figure key={`${section.id}-t-${idx}`}>
                      <table>
                        <thead>
                          <tr>{block.header.map((h, i) => <th key={`h-${i}`} dangerouslySetInnerHTML={{ __html: renderInlineMath(h) }} />)}</tr>
                        </thead>
                        <tbody>
                          {block.body.map((row, r) => <tr key={`r-${r}`}>{row.map((c, i) => <td key={`c-${r}-${i}`} dangerouslySetInnerHTML={{ __html: renderInlineMath(c) }} />)}</tr>)}
                        </tbody>
                      </table>
                      {block.caption ? <figcaption className="fig-cap">{block.caption}</figcaption> : null}
                    </figure>
                  );
                }
                return <p key={`${section.id}-p-${idx}`} dangerouslySetInnerHTML={{ __html: renderInlineMath(block.text) }} />;
              })}
            </section>
          ))}
        </article>
      </div>
    </>
  );
}
