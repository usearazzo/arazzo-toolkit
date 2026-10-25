// Regenerates packages/runner/assets/run-demo.svg and run-demo.txt from a real session: a
// Petstore container started with Docker, then a Node.js REPL that runs a workflow with the
// pinned @usearazzo/runner, pasted as one block in editor mode.
//
// usage: node packages/runner/assets/src/generate.mjs
//
// Requires Docker and util-linux `script` (the REPL's editor mode needs a terminal). The container
// is published on a free local port; the transcript shows the port a reader would use (8080).
// Colors mirror the terminal component on usearazzo.com (assets/css/main.css).
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER_VERSION = '1.0.1-alpha.10';
const PETSTORE_IMAGE = 'swaggerapi/petstore3:1.0.28';
const SHOWN_PORT = '8080';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..');

// pasted into the REPL as one block
const BLOCK = `const { DocumentRegistry, OpenAPIOperationExecutor, StepExecutor, WorkflowExecutor } =
  await import('@usearazzo/runner');

const registry = new DocumentRegistry();
const document = await registry.acquireEntryDocument(
  'https://usearazzo.com/assets/reference/runner/petstore-order.arazzo.yaml',
);
const operationExecutor = new OpenAPIOperationExecutor();
const stepExecutor = new StepExecutor({ document, registry, operationExecutor });
const executor = new WorkflowExecutor({ document, registry, stepExecutor });

const result = await executor.execute('authenticateAndOrderPet', {
  inputs: { username: 'theUser', password: '12345', preferredPetStatus: 'available', orderQuantity: 1 },
  executeOptions: { server: 'http://localhost:${SHOWN_PORT}/api/v3' },
});
result.steps.map((s) => \`\${s.successful ? '✓' : '✗'} \${s.stepId}\`);`;
const AFTER = 'result.status';

const ROWS = 20; // the terminal's height in lines; the session scrolls past it
const C = {
  bg: '#1F2937', bar: '#111827', border: '#374151', title: '#9CA3AF',
  prompt: '#A3D977', dollar: '#AEB6C2', input: '#E5E7EB', out: '#AEB6C2', value: '#A3D977',
};
const MONO = "'Fira Code',Monaco,Consolas,ui-monospace,SFMono-Regular,Menlo,'Liberation Mono',monospace";
const FONT = 14, CW = 8.43, LH = 22, PAD = 22, BAR = 36;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// install the pinned runner outside the repo; the REPL runs there so the import resolves
const prefix = mkdtempSync(join(tmpdir(), 'usearazzo-runner-'));
execFileSync('npm', ['install', '--silent', '--prefix', prefix, `@usearazzo/runner@${RUNNER_VERSION}`], { stdio: 'inherit' });

// start the Petstore the way the reader would, on a free port
const containerId = execFileSync('docker', ['run', '--rm', '-d', '-p', '127.0.0.1:0:8080', PETSTORE_IMAGE], { encoding: 'utf8' }).trim();
let session;
try {
  const binding = execFileSync('docker', ['port', containerId, '8080'], { encoding: 'utf8' }).trim().split('\n')[0];
  const port = binding.slice(binding.lastIndexOf(':') + 1);
  for (let i = 0; ; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/v3/openapi.json`)).ok) break;
    } catch {}
    if (i > 120) throw new Error('the Petstore did not start');
    await sleep(1000);
  }
  session = await runRepl(BLOCK.replace(`localhost:${SHOWN_PORT}`, `localhost:${port}`));
} finally {
  execFileSync('docker', ['stop', containerId], { stdio: 'ignore' });
}

// drives node in a pseudo-terminal: `.editor`, the block, Ctrl+D, then one more line
function runRepl(block) {
  return new Promise((resolve, reject) => {
    const repl = spawn('script', ['-qfec', `${process.execPath}`, '/dev/null'], {
      cwd: prefix,
      env: { ...process.env, NODE_DISABLE_COLORS: '1', TERM: 'dumb', COLUMNS: '300' },
    });
    let buffer = '';
    const waitFor = (pattern) => new Promise((done) => {
      const check = () => {
        const m = buffer.match(pattern);
        if (!m) return setTimeout(check, 50);
        const before = buffer.slice(0, m.index);
        buffer = buffer.slice(m.index + m[0].length);
        done(before);
      };
      check();
    });
    repl.stdout.setEncoding('utf8');
    repl.stdout.on('data', (chunk) => { buffer += chunk.replace(/\r/g, ''); });
    repl.on('error', reject);
    (async () => {
      const welcome = (await waitFor(/\n?> $/m)).split('\n').filter(Boolean);
      repl.stdin.write('.editor\n');
      const banner = (await waitFor(/cancel\)\n/)).split('\n').pop() + 'cancel)';
      for (const line of block.split('\n')) repl.stdin.write(`${line}\n`);
      repl.stdin.write('\x04');
      // the echoed block, then a blank line, then the value of the last expression
      const echoed = await waitFor(/\n> /);
      const value = echoed.slice(echoed.indexOf(block.split('\n').pop()) + block.split('\n').pop().length).replace(/^\n+/, '');
      repl.stdin.write(`${AFTER}\n`);
      const after = (await waitFor(/\n> /)).split('\n').slice(1).join('\n');
      repl.stdin.write('.exit\n');
      resolve({ welcome, banner, value: value.split('\n'), after: after.split('\n') });
    })().catch(reject);
  });
}

// --- transcript -------------------------------------------------------------------------------

const shownDocker = `docker run --rm -d -p ${SHOWN_PORT}:8080 ${PETSTORE_IMAGE}`;
const blockLines = BLOCK.split('\n');

// one entry per line: how it arrives (typed, pasted, or printed) and its colors
const lines = [
  { kind: 'typed', prompt: '$ ', text: shownDocker },
  { kind: 'out', text: containerId },
  { kind: 'typed', prompt: '$ ', text: 'node' },
  ...session.welcome.map((text) => ({ kind: 'out', text })),
  { kind: 'typed', prompt: '> ', text: '.editor' },
  { kind: 'out', text: session.banner },
  ...blockLines.map((text) => ({ kind: 'pasted', text })),
  { kind: 'out', text: '' },
  ...session.value.map((text) => ({ kind: 'value', text })),
  { kind: 'typed', prompt: '> ', text: AFTER },
  ...session.after.map((text) => ({ kind: 'value', text })),
];

writeFileSync(join(OUT, 'run-demo.txt'), `${lines.map((l) => (l.prompt ?? '') + l.text).join('\n')}\n`);

// --- svg --------------------------------------------------------------------------------------

// timing, in seconds
const T = { idle: 0.6, char: 0.035, enter: 0.35, out: 0.08, paste: 0.8, run: 1.2, hold: 4 };

let t = 0;
let pastedAt;
lines.forEach((l, i) => {
  if (l.kind === 'typed') {
    t += T.idle;
    l.typing = t;
    t += l.text.length * T.char;
    l.typed = t;
    l.at = l.typing;
    t += T.enter;
  } else if (l.kind === 'pasted') {
    if (pastedAt === undefined) {
      t += T.paste;
      pastedAt = t;
    }
    l.at = pastedAt;
  } else {
    // the run's output waits for the run itself
    if (l.kind === 'value' && lines[i - 1]?.kind === 'out' && lines[i - 2]?.kind === 'pasted') t += T.run;
    t += T.out;
    l.at = t;
  }
});
const D = t + T.hold;

const longest = Math.max(...lines.map((l) => (l.prompt ?? '').length + l.text.length));
const W = Math.ceil(longest * CW + PAD * 2);
const H = BAR + PAD + ROWS * LH + PAD - 8;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (v) => `${((v / D) * 100).toFixed(3)}%`;
const y = (row) => BAR + PAD + row * LH + FONT - 2;
// renderers collapse leading whitespace, so position past it explicitly
const text = (x, row, color, s) => {
  const lead = s.length - s.trimStart().length;
  return s.trim() ? `<text x="${(x + lead * CW).toFixed(1)}" y="${y(row)}" fill="${color}">${esc(s.trimStart())}</text>` : '';
};

const css = [];
const anim = (name) => `animation:${name} ${D.toFixed(2)}s linear infinite`;

// scrolling: once the session outgrows the terminal, every new line moves the content up one row
// lines that arrive together (a paste) scroll in one step, so keep one shift per moment
const shifts = [];
lines.forEach((l, i) => {
  const overflow = i + 1 - ROWS;
  if (overflow <= 0) return;
  if (shifts.length && shifts[shifts.length - 1].at === l.at) shifts[shifts.length - 1].by = overflow;
  else shifts.push({ at: l.at, by: overflow });
});
const finalShift = Math.max(0, lines.length - ROWS);
const scrollFrames = ['0%{transform:translateY(0)}'];
let prev = 0;
for (const { at, by } of shifts) {
  if (by === prev) continue;
  scrollFrames.push(`${pct(at - 0.001)}{transform:translateY(${-prev * LH}px)}`, `${pct(at)}{transform:translateY(${-by * LH}px)}`);
  prev = by;
}
scrollFrames.push(`100%{transform:translateY(${-prev * LH}px)}`);
css.push(`@keyframes scroll{${scrollFrames.join('')}}.scroll{${anim('scroll')}}`);

const body = lines.map((l, i) => {
  css.push(`@keyframes l${i}{0%,${pct(l.at - 0.001)}{opacity:0}${pct(l.at)},100%{opacity:1}}.l${i}{${anim(`l${i}`)}}`);
  if (l.kind === 'typed') {
    const n = l.text.length;
    const x0 = PAD + l.prompt.length * CW;
    css.push(`@keyframes t${i}{0%,${pct(l.typing)}{transform:translateX(0);animation-timing-function:steps(${n},end)}${pct(l.typed)},100%{transform:translateX(${(n * CW).toFixed(1)}px)}}.t${i}{${anim(`t${i}`)}}`);
    const promptColor = l.prompt === '$ ' ? C.dollar : C.prompt;
    const inputColor = l.prompt === '$ ' ? C.prompt : C.input;
    return `<g class="l${i}">${text(PAD, i, promptColor, l.prompt.trim())}${text(x0, i, inputColor, l.text)}<g class="t${i}" transform="translate(${(n * CW).toFixed(1)} 0)"><rect x="${x0.toFixed(1)}" y="${y(i) - FONT - 2}" width="${W}" height="${LH}" fill="${C.bg}"/></g></g>`;
  }
  const color = { pasted: C.input, value: C.value, out: C.out }[l.kind];
  return `<g class="l${i}">${text(PAD, i, color, l.text)}</g>`;
}).join('\n    ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Running an Arazzo workflow with @usearazzo/runner: start a Petstore with Docker, paste the runner code into a Node.js REPL, and every step of the workflow passes">
  <style>
    ${css.join('\n    ')}
    @media (prefers-reduced-motion: reduce){*{animation:none!important}}
  </style>
  <clipPath id="w"><rect width="${W}" height="${H}" rx="8"/></clipPath>
  <clipPath id="screen"><rect x="0" y="${BAR}" width="${W}" height="${H - BAR}"/></clipPath>
  <g clip-path="url(#w)">
    <rect width="${W}" height="${H}" fill="${C.bg}"/>
    <rect width="${W}" height="${BAR}" fill="${C.bar}"/>
    <rect y="${BAR - 1}" width="${W}" height="1" fill="${C.border}"/>
  </g>
  <circle cx="20" cy="18" r="5.5" fill="#FF5F56"/><circle cx="38" cy="18" r="5.5" fill="#FFBD2E"/><circle cx="56" cy="18" r="5.5" fill="#27C93F"/>
  <text x="74" y="22" fill="${C.title}" font-family="${MONO}" font-size="12">@usearazzo/runner</text>
  <g clip-path="url(#screen)">
  <g class="scroll" transform="translate(0 ${-finalShift * LH})" font-family="${MONO}" font-size="${FONT}" xml:space="preserve">
    ${body}
  </g>
  </g>
</svg>
`;
writeFileSync(join(OUT, 'run-demo.svg'), svg);
console.log(`run-demo.svg ${W}x${H}, ${lines.length} lines, ${D.toFixed(1)} s loop`);
