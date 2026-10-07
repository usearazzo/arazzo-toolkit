import path from 'node:path';
import fs from 'node:fs';

import stripAnsi from './strip-ansi.ts';

// true when writing to outputPath would clobber the file at inputPath. Resolved
// path strings are compared first; when the output already exists, filesystem
// identity (device + inode) is compared too, so a symlink, hard link, or
// case-insensitive-filesystem alias (Arazzo.yaml vs arazzo.yaml) to the input
// is caught even though the path strings differ. statSync follows symlinks, so
// an output symlink pointing at the input resolves to the input's inode. When
// the output does not exist there is nothing on disk to alias, so the string
// compare is authoritative. ino is only trusted when non-zero (it can be 0 on
// some Windows/network filesystems, which would otherwise alias every file).
//
// not covered: an output path matching a source description rather than the
// entry document — the resolved source descriptions are not tracked here.
export const wouldOverwriteInput = (outputPath: string, inputPath: string): boolean => {
  const resolvedOutput = path.resolve(outputPath);
  const resolvedInput = path.resolve(inputPath);
  if (resolvedOutput === resolvedInput) {
    return true;
  }
  try {
    const outputStat = fs.statSync(resolvedOutput);
    const inputStat = fs.statSync(resolvedInput);
    return (
      outputStat.ino !== 0 && outputStat.dev === inputStat.dev && outputStat.ino === inputStat.ino
    );
  } catch {
    // output (or input) is absent or not statable — no on-disk alias possible
    return false;
  }
};

// write the formatted diagnostics report to its destination. stdout is the
// default (stderr stays reserved for hard errors); a path from -o/--output
// redirects it to a file instead.
//
// Only the stylish formatter emits chalk colors, and it keys them on
// process.stdout's TTY state — unaware the bytes are being written to a file.
// So ANSI is stripped for file output only; the json formatter emits none and
// is written exactly as rendered, and stdout keeps its colors for the terminal.
const writeReport = (rendered: string, format: string, outputPath?: string): void => {
  if (!outputPath) {
    process.stdout.write(rendered);
    return;
  }

  const absPath = path.resolve(outputPath);
  const payload = format === 'json' ? rendered : stripAnsi(rendered);
  try {
    fs.writeFileSync(absPath, payload, 'utf-8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to write ${absPath}: ${message}`, { cause: error });
  }
};

export default writeReport;
