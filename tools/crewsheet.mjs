// Contact sheets for the crew lab: node tools/crewsheet.mjs <out.png> <columns> <cellWidth> <img> <img> ...
// Cells are resized to the given width and laid out left to right, top to bottom (needs ImageMagick's `magick`).
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
const [out, cols, cellW, ...imgs] = process.argv.slice(2);
if (!out || !imgs.length) { console.error('usage: crewsheet.mjs out.png columns cellWidth img...'); process.exit(1); }
const tmp = fs.mkdtempSync('/tmp/sheet-');
const rows = [];
for (let i = 0; i < imgs.length; i += +cols) {
  const f = path.join(tmp, `row${rows.length}.png`);
  execFileSync('magick', [...imgs.slice(i, i + +cols).flatMap((p) => ['(', p, '-resize', `${cellW}x`, ')']), '+append', f]);
  rows.push(f);
}
execFileSync('magick', [...rows, '-append', out]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('wrote', out);
