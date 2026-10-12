// Shared paths and guards for the desk scripts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (the folder that holds desk/). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The user's data folder: $CAREER_OPS_DATA_DIR, resolved against the root; default "profile". */
export const DATA = path.resolve(ROOT, process.env.CAREER_OPS_DATA_DIR || 'profile');

/** True when the calling module is the script node was started with (paths with spaces and symlinks included). */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(fileURLToPath(metaUrl)) === fs.realpathSync(process.argv[1]); }
  catch { return false; }
}

/** Ids that end up in file names and document paths: letters, digits, _ and -, at most 64. */
export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
export const safeId = id => typeof id === 'string' && SAFE_ID.test(id) && !RESERVED.has(id);

/** A plain object with no prototype, for maps keyed by untrusted ids. */
export const dict = () => Object.create(null);

/**
 * Parse YAML with an error that names only the file, the reason and the line. js-yaml's own
 * message quotes the lines around the error, and those reach the page as a problem detail.
 */
export function parseYaml(yaml, src, file) {
  try { return yaml.load(src); }
  catch (e) { throw new Error(`${path.basename(file)}: ${e.reason || 'not valid YAML'}${e.mark ? ` (line ${e.mark.line + 1})` : ''}`); }
}

/** Read YAML that must parse: a broken file throws instead of silently becoming {}. */
export function readYamlStrict(yaml, file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const v = parseYaml(yaml, fs.readFileSync(file, 'utf8'), file);
  return v ?? fallback;
}
