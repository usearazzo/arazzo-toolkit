// Regenerates packages/runner/assets/run-demo.svg and run-demo.txt from a real session: a
// Petstore container started with Docker, then a Node.js REPL running a workflow with the
// pinned @usearazzo/runner against it.
//
// usage: node packages/runner/assets/src/generate.mjs
//
// Requires Docker. The container is published on a free local port; the transcript shows the
// port the reader would use (8080). Colors mirror the terminal component on usearazzo.com.
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

const REPL_LINES = [
  "const runner = await import('@usearazzo/runner')",
  "const url = 'https://usearazzo.com/assets/reference/runner/petstore-order.arazzo.yaml'",
  'const registry = new runner.DocumentRegistry()',
  'const document = await registry.acquireEntryDocument(url)',
  'const operationExecutor = new runner.OpenAPIOperationExecutor()',
  'const stepExecutor = new runner.StepExecutor({ document, registry, operationExecutor })',
  'const executor = new runner.WorkflowExecutor({ document, registry, stepExecutor })',
  "const inputs = { username: 'theUser', password: '12345', preferredPetStatus: 'available', orderQuantity: 1 }",
  `const options = { inputs, executeOptions: { server: 'http://localhost:${SHOWN_PORT}/api/v3' } }`,
  "const result = await executor.execute('authenticateAndOrderPet', options)",
  'result.status',
  "result.steps.map((s) => `${s.successful ? '✓' : '✗'} ${s.stepId}`)",
];
// how many REPL lines each screen shows; the first screen opens with the shell commands
const SCREENS = [4, 5, 3];

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
const dockerArgs = ['run', '--rm', '-d', '-p', `127.0.0.1:0:8080`, PETSTORE_IMAGE];
const containerId = execFileSync('docker', dockerArgs, { encoding: 'utf8' }).trim();
let replOutputs;
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
  replOutputs = await runRepl(REPL_LINES.map((l) => l.replace(`localhost:${SHOWN_PORT}`, `localhost:${port}`)));
} finally {
  execFileSync('docker', ['stop', containerId], { stdio: 'ignore' });
}

// drives `node -i`, sending each line only after the previous one settled, as a person would
function runRepl(lines) {
  return new Promise((resolve, reject) => {
    const repl = spawn(process.execPath, ['-i'], { cwd: prefix, env: { ...process.env, NODE_DISABLE_COLORS: '1' } });
    let buffer = '';
    const outputs = [];
    let next = 0;
    repl.stdout.setEncoding('utf8');
    repl.stdout.on('data', (chunk) => {
      buffer += chunk;
      // a prompt at the end of the buffer means the REPL is ready for the next line
      if (!buffer.endsWith('> ')) return;
      const text = buffer.slice(0, -2).replace(/\n$/, '');
      buffer = '';
      if (next > 0) outputs.push(text);
      if (next === lines.length) {
        repl.stdin.end('.exit\n');
        return;
      }
      repl.stdin.write(`${lines[next]}\n`);
      next += 1;
    });
    repl.on('error', reject);
    repl.on('close', () => resolve(outputs));
  });
}

// --- transcript -------------------------------------------------------------------------------

const shownDocker = `docker run --rm -d -p ${SHOWN_PORT}:8080 ${PETSTORE_IMAGE}`;
const nodeVersion = process.version;
const welcome = [`Welcome to Node.js ${nodeVersion}.`, 'Type ".help" for more information.'];
const entries = REPL_LINES.map((input, i) => ({ input, output: replOutputs[i].split('\n') }));

writeFileSync(join(OUT, 'run-demo.txt'), [
  `$ ${shownDocker}`,
  containerId,
  '$ node',
  ...welcome,
  ...entries.flatMap((e) => [`> ${e.input}`, ...e.output]),
  '',
].join('\n'));

// --- svg --------------------------------------------------------------------------------------

const outColor = (line) => (/^(undefined)$/.test(line) ? C.out : C.value);

// each screen is a list of typed commands with their output
const screens = [];
const shell = [
  { prompt: '$ ', input: shownDocker, output: [containerId].map((t) => ({ text: t, color: C.out })) },
  { prompt: '$ ', input: 'node', output: welcome.map((t) => ({ text: t, color: C.out })) },
];
let from = 0;
SCREENS.forEach((count, i) => {
  const repl = entries.slice(from, from + count).map((e) => ({
    prompt: '> ', input: e.input, output: e.output.map((t) => ({ text: t, color: outColor(t) })),
  }));
  screens.push(i === 0 ? [...shell, ...repl] : repl);
  from += count;
});

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lineCount = (screen) => screen.reduce((n, e) => n + 1 + e.output.length, 0);
const longest = Math.max(...screens.flat().flatMap((e) => [e.prompt.length + e.input.length, ...e.output.map((o) => o.text.length)]));
const W = Math.ceil(longest * CW + PAD * 2);
const H = BAR + PAD + Math.max(...screens.map(lineCount)) * LH + PAD - 8;

// typing animation timing, in seconds: shell commands type slower than REPL lines
const T = { idle: 0.5, shell: 0.035, repl: 0.012, enter: 0.3, line: 0.25, hold: 3.5, perLine: 0.04 };

const y = (row) => BAR + PAD + row * LH + FONT - 2;
// renderers collapse leading whitespace, so position past it explicitly
const text = (x, row, color, s, bold) => {
  const lead = s.length - s.trimStart().length;
  return `<text x="${(x + lead * CW).toFixed(1)}" y="${y(row)}" fill="${color}"${bold ? ' font-weight="700"' : ''}>${esc(s.trimStart())}</text>`;
};

let t = 0;
const css = [];
const pct = (v) => `${((v / D) * 100).toFixed(3)}%`;
let D = 0;
const plan = screens.map((screen) => {
  const start = t;
  let row = 0;
  const items = screen.map((e) => {
    t += e.prompt === '$ ' ? T.idle : T.line;
    const typing = t;
    t += e.input.length * (e.prompt === '$ ' ? T.shell : T.repl);
    const typed = t;
    t += T.enter;
    const shown = t;
    t += e.output.length * T.perLine;
    const item = { ...e, row, typing, typed, shown };
    row += 1 + e.output.length;
    return item;
  });
  t += T.hold;
  return { start, end: t, items };
});
D = t;

let k = 0;
const body = plan.map((screen, i) => {
  css.push(i === 0
    ? `@keyframes s${i}{0%,${pct(screen.end)}{opacity:1}${pct(screen.end + 0.001)},100%{opacity:0}}`
    : `@keyframes s${i}{0%,${pct(screen.start)}{opacity:0}${pct(screen.start + 0.001)},${pct(screen.end)}{opacity:1}${pct(screen.end + 0.001)},100%{opacity:0}}`);
  css.push(`.s${i}{animation:s${i} ${D.toFixed(2)}s linear infinite}`);
  const items = screen.items.map((e) => {
    const j = k++;
    const n = e.input.length;
    const x0 = PAD + e.prompt.length * CW;
    // a background-colored cover slides off the input one character at a time; the line and
    // the output stay hidden until the screen reaches them
    css.push(`@keyframes a${j}{0%,${pct(e.typing - 0.001)}{opacity:0}${pct(e.typing)},100%{opacity:1}}`);
    css.push(`@keyframes t${j}{0%,${pct(e.typing)}{transform:translateX(0);animation-timing-function:steps(${n},end)}${pct(e.typed)},100%{transform:translateX(${(n * CW).toFixed(1)}px)}}`);
    css.push(`@keyframes o${j}{0%,${pct(e.shown)}{opacity:0}${pct(e.shown + 0.001)},100%{opacity:1}}`);
    css.push(`.a${j}{animation:a${j} ${D.toFixed(2)}s linear infinite}.t${j}{animation:t${j} ${D.toFixed(2)}s linear infinite}.o${j}{animation:o${j} ${D.toFixed(2)}s linear infinite}`);
    const promptColor = e.prompt === '$ ' ? C.dollar : C.prompt;
    return `<g class="a${j}">
      ${text(PAD, e.row, promptColor, e.prompt.trim())}${text(x0, e.row, e.prompt === '$ ' ? C.prompt : C.input, e.input)}
      <g class="t${j}" transform="translate(${(n * CW).toFixed(1)} 0)"><rect x="${x0.toFixed(1)}" y="${y(e.row) - FONT + 2 - 4}" width="${W}" height="${LH}" fill="${C.bg}"/></g>
      <g class="o${j}">${e.output.map((o, r) => text(PAD, e.row + 1 + r, o.color, o.text)).join('')}</g>
    </g>`;
  }).join('\n    ');
  // without animation (reduced motion), the last screen shows complete
  const still = i === plan.length - 1 ? '' : ' opacity="0"';
  return `<g class="s${i}"${still}>
    ${items}
  </g>`;
}).join('\n  ');

const title = '@usearazzo/runner';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Running an Arazzo workflow with @usearazzo/runner: start a Petstore with Docker, then run the workflow in a Node.js REPL; every step passes">
  <style>
    ${css.join('\n    ')}
    @media (prefers-reduced-motion: reduce){*{animation:none!important}}
  </style>
  <clipPath id="w"><rect width="${W}" height="${H}" rx="8"/></clipPath>
  <g clip-path="url(#w)">
    <rect width="${W}" height="${H}" fill="${C.bg}"/>
    <rect width="${W}" height="${BAR}" fill="${C.bar}"/>
    <rect y="${BAR - 1}" width="${W}" height="1" fill="${C.border}"/>
  </g>
  <circle cx="20" cy="18" r="5.5" fill="#FF5F56"/><circle cx="38" cy="18" r="5.5" fill="#FFBD2E"/><circle cx="56" cy="18" r="5.5" fill="#27C93F"/>
  <text x="74" y="22" fill="${C.title}" font-family="${MONO}" font-size="12">${title}</text>
  <g font-family="${MONO}" font-size="${FONT}" xml:space="preserve">
  ${body}
  </g>
</svg>
`;
writeFileSync(join(OUT, 'run-demo.svg'), svg);
console.log(`run-demo.svg ${W}x${H}, ${D.toFixed(1)} s loop`);
