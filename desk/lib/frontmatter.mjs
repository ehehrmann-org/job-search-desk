// Front matter of jds/<id>.md files: a YAML block between --- lines, then the description.
import fs from 'node:fs';
import * as yaml from 'js-yaml';

export function readFrontMatter(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const m = txt.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: txt };
  return { meta: yaml.load(m[1]) || {}, body: m[2] };
}
