// Regenerates packages/cli/assets/validate-demo.svg from real @usearazzo/cli output.
//
// usage: node packages/cli/assets/src/generate.mjs
//
// Installs the pinned CLI in a temporary directory and runs it from specs/, so the file names in
// the output are relative, exactly as the usearazzo.com/validator/ demo shows them.
// Colors mirror the terminal component on usearazzo.com (assets/css/main.css).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_VERSION = '1.0.1-alpha.10';
const HERE = dirname(fileURLToPath(import.meta.url));
const SPECS = join(HERE, 'specs');
const OUT = join(HERE, '..');

const SESSIONS = {
  validate: {
    title: 'usearazzo validate',
    runs: ['adopt-a-pet.arazzo.yaml', 'onboarding.arazzo.yaml'].map((f) => ({
      cmd: 'validate',
      args: [f],
    })),
  },
};

const C = {
  bg: '#1F2937', bar: '#111827', border: '#374151', title: '#9CA3AF',
  prompt: '#A3D977', dollar: '#AEB6C2', arg: '#E5E7EB', file: '#FFFFFF', loc: '#AEB6C2',
  msg: '#E5E7EB', code: '#3DD6EE', error: '#F87171', warn: '#FBBF24', hint: '#3DD6EE', ok: '#A3D977',
};
const MONO = "'Fira Code',Monaco,Consolas,ui-monospace,SFMono-Regular,Menlo,'Liberation Mono',monospace";
const FONT = 14, CW = 8.43, LH = 22, PAD = 22, BAR = 36;

// install the pinned CLI outside the repo
const prefix = mkdtempSync(join(tmpdir(), 'usearazzo-cli-'));
execFileSync('npm', ['install', '--silent', '--prefix', prefix, `@usearazzo/cli@${CLI_VERSION}`], { stdio: 'inherit' });
const bin = join(prefix, 'node_modules', '.bin', 'usearazzo');

function run(cmd, args) {
  try {
    return execFileSync(bin, [...cmd.split(' '), ...args], { cwd: SPECS, encoding: 'utf8' });
  } catch (e) {
    return e.stdout; // a document with errors exits with 1
  }
}

// map CLI output to the usearazzo.com terminal token classes
function classify(line) {
  if (line.startsWith('✖')) return [{ text: line, color: C.error, bold: true }];
  if (line.startsWith('⚠')) return [{ text: line, color: C.warn, bold: true }];
  if (line.startsWith('✔')) return [{ text: line, color: C.ok, bold: true }];
  const d = line.match(/^(\s+)(\S+\s*)(\s+)(error|warning|info|hint)(\s+)(\S+)(\s+)(.*)$/);
  if (d) {
    const [, i, loc, s1, sev, s2, code, s3, msg] = d;
    const color = { error: C.error, warning: C.warn, info: C.hint, hint: C.hint }[sev];
    return [
      { text: i + loc + s1, color: C.loc }, { text: sev, color },
      { text: s2, color: C.msg }, { text: code, color: C.code }, { text: s3 + msg, color: C.msg },
    ];
  }
  return [{ text: line, color: C.file, bold: true }];
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const width = (segs) => segs.reduce((n, s) => n + [...s.text].length, 0);

// typing animation timing, in seconds
const T = { idle: 0.6, char: 0.035, enter: 0.35, hold: 3.2, perLine: 0.12 };

// each run becomes one animation frame: a typed command, then its output
const rendered = Object.entries(SESSIONS).map(([name, session]) => {
  const frames = session.runs.map(({ cmd, args }) => {
    const command = `npx @usearazzo/cli ${cmd} ${args.join(' ')}`;
    const prompt = [
      { text: '$ ', color: C.dollar },
      { text: `npx @usearazzo/cli ${cmd} `, color: C.prompt },
      { text: args.join(' '), color: C.arg },
    ];
    const output = run(cmd, args).replace(/\n+$/, '').split('\n').map((l) => (l ? classify(l) : []));
    return { command, prompt, output };
  });
  return { name, session, frames };
});

const W = Math.ceil(Math.max(...rendered.flatMap((r) => r.frames.flatMap((f) => [f.prompt, ...f.output].map(width)))) * CW + PAD * 2);

const textLine = (segs, i) => {
  const y = BAR + PAD + i * LH + FONT - 2;
  let col = 0;
  return segs.map((s) => {
    // renderers collapse leading whitespace, so position past it explicitly
    const lead = s.text.length - s.text.trimStart().length;
    const x = (PAD + (col + lead) * CW).toFixed(1);
    col += [...s.text].length;
    if (!s.text.trim()) return '';
    return `<text x="${x}" y="${y}" fill="${s.color}"${s.bold ? ' font-weight="700"' : ''}>${esc(s.text.trimStart())}</text>`;
  }).join('');
};

const pct = (t, total) => `${((t / total) * 100).toFixed(3)}%`;

for (const { name, session, frames } of rendered) {
  const H = BAR + PAD + Math.max(...frames.map((f) => 1 + f.output.length)) * LH + PAD - 8;

  // timeline: idle cursor, type the command, press enter, show output, hold
  let t = 0;
  const timed = frames.map((f) => {
    const n = [...f.command].length;
    const start = t;
    const typed = start + T.idle + n * T.char;
    const shown = typed + T.enter;
    t = shown + T.hold + f.output.length * T.perLine;
    return { ...f, n, start, typing: start + T.idle, typed, shown, end: t };
  });
  const D = t;

  const css = [];
  const body = timed.map((f, i) => {
    const [s, e] = [pct(f.start, D), pct(f.end, D)];
    // frame visibility
    css.push(i === 0
      ? `@keyframes f${i}{0%,${e}{opacity:1}${pct(f.end + 0.001, D)},100%{opacity:0}}`
      : `@keyframes f${i}{0%,${s}{opacity:0}${pct(f.start + 0.001, D)},${e}{opacity:1}${pct(f.end + 0.001, D)},100%{opacity:0}}`);
    // a background-colored cover slides off the command in steps, one character at a time
    css.push(`@keyframes t${i}{0%,${pct(f.typing, D)}{transform:translateX(0);animation-timing-function:steps(${f.n},end)}`
      + `${pct(f.typed, D)},100%{transform:translateX(${(f.n * CW).toFixed(1)}px)}}`);
    css.push(`@keyframes o${i}{0%,${pct(f.shown, D)}{opacity:0}${pct(f.shown + 0.001, D)},100%{opacity:1}}`);
    css.push(`@keyframes c${i}{0%,${pct(f.shown, D)}{opacity:1}${pct(f.shown + 0.001, D)},100%{opacity:0}}`);
    css.push(`.f${i}{animation:f${i} ${D.toFixed(2)}s linear infinite}`
      + `.t${i}{animation:t${i} ${D.toFixed(2)}s linear infinite}`
      + `.o${i}{animation:o${i} ${D.toFixed(2)}s linear infinite}`
      + `.c${i}{animation:c${i} ${D.toFixed(2)}s linear infinite}`);

    const x0 = PAD + 2 * CW;
    const y0 = BAR + PAD - 3;
    // without animation (reduced motion), the first frame shows complete
    const still = i === 0 ? '' : ' opacity="0"';
    return `<g class="f${i}"${still}>
    ${textLine(f.prompt, 0)}
    <g class="t${i}" transform="translate(${(f.n * CW).toFixed(1)} 0)">
      <rect x="${x0}" y="${y0}" width="${W}" height="${LH}" fill="${C.bg}"/>
      <g class="blink"><rect class="c${i}" x="${x0}" y="${y0 + 1}" width="${CW.toFixed(1)}" height="${LH - 4}" fill="${C.msg}" opacity="0"/></g>
    </g>
    <g class="o${i}">
    ${f.output.map((segs, j) => textLine(segs, j + 1)).join('\n    ')}
    </g>
  </g>`;
  }).join('\n  ');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(session.title)}: ${esc(timed.map((f) => f.command).join(', '))}">
  <style>
    ${css.join('\n    ')}
    .blink{animation:blink 1s steps(2,start) infinite}
    @keyframes blink{to{visibility:hidden}}
    @media (prefers-reduced-motion: reduce){*{animation:none!important}}
  </style>
  <clipPath id="w"><rect width="${W}" height="${H}" rx="8"/></clipPath>
  <g clip-path="url(#w)">
    <rect width="${W}" height="${H}" fill="${C.bg}"/>
    <rect width="${W}" height="${BAR}" fill="${C.bar}"/>
    <rect y="${BAR - 1}" width="${W}" height="1" fill="${C.border}"/>
  </g>
  <circle cx="20" cy="18" r="5.5" fill="#FF5F56"/><circle cx="38" cy="18" r="5.5" fill="#FFBD2E"/><circle cx="56" cy="18" r="5.5" fill="#27C93F"/>
  <text x="74" y="22" fill="${C.title}" font-family="${MONO}" font-size="12">${esc(session.title)}</text>
  <g font-family="${MONO}" font-size="${FONT}" xml:space="preserve">
  ${body}
  </g>
</svg>
`;
  writeFileSync(join(OUT, `${name}-demo.svg`), svg);
  console.log(`${name}-demo.svg ${W}x${H}`);
}
