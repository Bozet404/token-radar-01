// Fathom — token-radar-01, radar-3 (Node 22, standard library only).
//
// What this program does, end to end:
//   1. reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>),
//   2. fits the comps model in lib/model.ts and ranks the pre-token board,
//   3. refuses to write anything if the board fails the gate's own shape,
//   4. writes /output/board.json and /output/data.js (the page's dataset),
//   5. copies dashboard/ and screenshots/ into /output,
//   6. writes /output/dossier.json with the vendored make.fun library,
//      last, so the dossier is built from exactly what was handed in.
//
// The dashboard is a static page with no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read the
// data.js this program writes from the same board the gate sees. The
// board covers the whole watchlist plus the early protocols below the
// floor, prices every row with the one fitted model, and gives each row
// a five-step farm plan that follows its mechanism.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// The caps the scorer enforces (reference/gate.json). Only the text cap
// shapes bytes; the rest refuse outright, so the dossier call passes them.
const DOSSIER_TEXT_BYTES = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASH_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the arguments, else `orElse`. */
function option(name: string, orElse: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1] as string;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? orElse : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`fathom: ${message}\n`);
  process.exit(1);
}

const inputPath = option('input', '/input');
const snapPath = inputPath.endsWith('.json') ? inputPath : join(inputPath, 'snapshot.json');
if (!existsSync(snapPath)) {
  fail(`no snapshot at ${snapPath}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapPath, 'utf8'));
const radar = buildRadar(snapshot);
const problem = boardIssue(radar.board, snapshot);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: radar.board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `dest`, skipping dot-names, and report what landed. */
function copyPlain(from: string, dest: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(dest, { recursive: true });
  const landed: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(dest, name));
    landed.push(name);
  }
  return landed;
}

const pageFiles = copyPlain(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyPlain(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
// A screenshot taken before the last dashboard edit shows the old page:
// warn instead of silently shipping it, since the dossier freezes it in.
const newestPage = pageFiles
  .map((n) => statSync(join(repoRoot, 'dashboard', n)).mtimeMs)
  .reduce((a, b) => Math.max(a, b), 0);
for (const name of shots) {
  if (statSync(join(repoRoot, 'screenshots', name)).mtimeMs < newestPage) {
    process.stderr.write(
      `fathom: warning — screenshots/${name} is older than dashboard/: re-take it so the dossier shows this build\n`,
    );
  }
}
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier goes last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_BYTES, screenshots: SHOT_CAPS, dashboard: DASH_CAPS }),
);

const fit = radar.fit;
process.stdout.write(
  `fathom: ${snapshot.protocols.length} protocols in the snapshot, ${snapshot.watchlist.length} on the watchlist, ${radar.board.length} rows priced (${radar.watchlistSize} watchlist, ${radar.earlySize} early)\n` +
    `fathom: fitted on ${fit.compsUsed} launched tokens — log10(mcap) = ${fit.intercept.toFixed(3)} + ${fit.slopeTvl.toFixed(3)}·log10(TVL) ${fit.coefGrowth.toFixed(3)}·growth ${fit.coefAge.toFixed(3)}·age, residual sd ${fit.residualSd.toFixed(3)} dex\n` +
    `fathom: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${pageFiles.length} files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
