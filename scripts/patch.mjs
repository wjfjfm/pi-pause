import { readFile, writeFile, mkdir, access, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import changes from './changes.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const exists = path => access(path).then(() => true, () => false);

// root is node_modules/@earendil-works, not a source checkout.
export async function patch(root, { restore = false, check = false } = {}) {
  root = resolve(root);
  const backup = join(root, '.pi-pause-backup');
  const manifestPath = join(backup, 'manifest.json');
  if (await exists(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const entry of manifest) {
      if (hash(await readFile(join(root, entry.file), 'utf8')) !== entry.after) {
        throw new Error(`Refusing to overwrite modified file: ${entry.file}`);
      }
    }
    if (!restore) return 'Already patched';
    const originals = await Promise.all(manifest.map(async entry => {
      const text = await readFile(join(backup, entry.file), 'utf8');
      if (hash(text) !== entry.before) throw new Error(`Corrupt backup: ${entry.file}`);
      return { ...entry, text };
    }));
    if (check) return 'Restore validated';
    for (const entry of originals) await writeFile(join(root, entry.file), entry.text);
    // Retain the backup, but invalidate the installed-state manifest.
    await writeFile(manifestPath + '.restored', JSON.stringify(manifest, null, 2));
    await unlink(manifestPath);
    return 'Restored; restart Pi';
  }
  if (restore) throw new Error('No installed patch manifest');
  for (const name of ['pi-coding-agent', 'pi-agent-core']) {
    const pkg = JSON.parse(await readFile(join(root, name, 'package.json'), 'utf8'));
    if (pkg.version !== '1.3.0') throw new Error(`Unsupported ${name} version: ${pkg.version}`);
  }
  const files = new Map();
  for (const change of changes) {
    let entry = files.get(change.file);
    if (!entry) {
      const original = await readFile(join(root, change.file), 'utf8');
      entry = { file: change.file, original, text: original };
      files.set(change.file, entry);
    }
    const matches = entry.text.split(change.oldText).length - 1;
    if (matches !== change.count) throw new Error(`${change.file}: expected ${change.count} matches, found ${matches}: ${change.oldText}`);
    entry.text = entry.text.split(change.oldText).join(change.newText);
  }
  if (check) return `Validated ${files.size} files (no changes)`;
  // Validate every edit before touching the installation; save all originals first.
  for (const entry of files.values()) {
    await mkdir(dirname(join(backup, entry.file)), { recursive: true });
    await writeFile(join(backup, entry.file), entry.original);
  }
  try {
    for (const entry of files.values()) await writeFile(join(root, entry.file), entry.text);
    await writeFile(manifestPath, JSON.stringify([...files.values()].map(entry => ({
      file: entry.file, before: hash(entry.original), after: hash(entry.text),
    })), null, 2));
  } catch (error) {
    for (const entry of files.values()) await writeFile(join(root, entry.file), entry.original);
    throw error;
  }
  return 'Patched; restart Pi (not /reload)';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) throw new Error('Usage: node scripts/patch.mjs <node_modules/@earendil-works> [--check|--restore]');
  console.log(await patch(root, { check: process.argv.includes('--check'), restore: process.argv.includes('--restore') }));
}
