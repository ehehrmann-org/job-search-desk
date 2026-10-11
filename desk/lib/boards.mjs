// Which job board reader the daily scan would use for a company or a link (null: none).
// The upstream reader registry is loaded once per process.
import path from 'node:path';
import { loadProviders, resolveProvider } from '../../providers/_registry.mjs';
import { ROOT } from './env.mjs';

let providers = null;

export async function boardFor(entryOrUrl) {
  providers ||= await loadProviders(path.join(ROOT, 'providers'));
  const entry = typeof entryOrUrl === 'string' ? { name: 'check', careers_url: entryOrUrl } : { ...entryOrUrl, enabled: true };
  try {
    const hit = resolveProvider(entry, providers, { skipIds: ['local-parser'] });
    return hit?.provider ? hit.provider.id : null;
  } catch { return null; }
}
