import { mkdirSync, writeFileSync } from 'node:fs';
import { visibleWidth } from '@earendil-works/pi-tui';
import { createHarness, demoHeaders } from '../tests/harness.js';

const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const h = createHarness();
h.start();
h.emit('after_provider_response', { headers: demoHeaders });
const lines: string[] = h.state.component.render(118);
h.stop();

function textSpans(line: string, y: number) {
  const parts = line.split(/(\x1b\[[0-9;]*m)/);
  let color = '#c9d1d9';
  let column = 0;
  const spans = [];
  for (const part of parts) {
    if (part.startsWith('\x1b[')) {
      const m = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(part);
      color = m ? `rgb(${m[1]},${m[2]},${m[3]})` : '#c9d1d9';
    } else if (part) {
      spans.push(`<tspan x="${30 + column * 8.4}" y="${y}" fill="${color}">${escape(part)}</tspan>`);
      column += visibleWidth(part);
    }
  }
  return `<text xml:space="preserve">${spans.join('')}</text>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1060" height="310" viewBox="0 0 1060 310" role="img" aria-labelledby="title description">
<title id="title">Pi Rainbow Footer</title>
<desc id="description">Actual footer rendering with synthetic session and quota data.</desc>
<rect width="1060" height="310" rx="16" fill="#0d1117"/>
<path d="M16 0H1044Q1060 0 1060 16V44H0V16Q0 0 16 0" fill="#161b22"/>
<circle cx="24" cy="23" r="5" fill="#ff5f57"/><circle cx="43" cy="23" r="5" fill="#febc2e"/><circle cx="62" cy="23" r="5" fill="#28c840"/>
<g font-family="'Cascadia Code','SFMono-Regular',Consolas,monospace" font-size="14">
<text x="87" y="28" fill="#8b949e">pi-rainbow-footer</text>
<text x="30" y="85" fill="#7ee787">Pi · rainbow footer demo</text>
<text x="30" y="125" fill="#c9d1d9">A little color for your coding sessions.</text>
<text x="30" y="155" fill="#8b949e">Session stats, cache hit rate, context, and optional Codex quota.</text>
<path d="M30 187H1030" stroke="#30363d"/>
${textSpans(lines[0], 218)}
${textSpans(lines[1], 247)}
<text x="30" y="285" fill="#6e7681" font-size="11">Rendered preview · synthetic data · colors animate in the terminal</text>
</g></svg>\n`;
mkdirSync(new URL('../assets/', import.meta.url), { recursive: true });
writeFileSync(new URL('../assets/preview.svg', import.meta.url), svg);
console.log('Wrote assets/preview.svg using the extension renderer.');
