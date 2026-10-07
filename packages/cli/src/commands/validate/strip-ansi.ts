// remove ANSI SGR escape sequences (e.g. chalk colors) so file output is plain
// text. Matches ESC[…m — the only sequences the stylish formatter emits. ESC is
// built from its code point to keep a raw control byte out of the source.
const ansiSgrPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const stripAnsi = (text: string): string => text.replace(ansiSgrPattern, '');

export default stripAnsi;
