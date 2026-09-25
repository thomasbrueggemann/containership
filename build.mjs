// Concatenates src/*.js (in order) into a single self-contained index.html
import fs from 'fs';
const head = fs.readFileSync('src/head.html', 'utf8');
const files = fs.readdirSync('src').filter((f) => f.endsWith('.js')).sort();
let js = '';
for (const f of files) js += `\n// ---- ${f} ----\n` + fs.readFileSync('src/' + f, 'utf8');
fs.writeFileSync('index.html', head + js + '\n</script>\n</body>\n</html>\n');
console.log('index.html built from', files.length, 'modules,', (Buffer.byteLength(head + js) / 1024).toFixed(0), 'KB');
