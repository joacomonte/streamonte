// Lista los `run:` de los jobs de .github/workflows/ci.yml como líneas "job<TAB>carpeta<TAB>comando" (para ci-local.sh).
// Parser mínimo para el formato de ese archivo: `defaults: { run: { working-directory: X } }` en el job y
// `- run: cmd` (con `working-directory:` opcional en la línea siguiente). Sin dependencias.
import { readFileSync } from "node:fs";

let job = "", jobDir = ".", last = null;
const steps = [];
for (const line of readFileSync(".github/workflows/ci.yml", "utf8").split("\n")) {
  let m;
  if ((m = line.match(/^  ([\w-]+):\s*$/))) { job = m[1]; jobDir = "."; last = null; }
  else if ((m = line.match(/^    defaults:.*working-directory:\s*(\S+)\s*\}/))) jobDir = m[1];
  else if ((m = line.match(/^      - run: (.*)$/))) steps.push((last = { job, dir: jobDir, cmd: m[1] }));
  else if (/^      - /.test(line)) last = null;
  else if ((m = line.match(/^        working-directory:\s*(\S+)/)) && last) last.dir = m[1];
}
for (const s of steps) console.log(`${s.job}\t${s.dir}\t${s.cmd}`);
