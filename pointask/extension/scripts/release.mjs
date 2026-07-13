import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const release = resolve(root, '..', 'release');
const archive = resolve(release, 'pointask-mvp-0.1.0.zip');
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });

rmSync(resolve(root, 'dist'), { recursive: true, force: true });
rmSync(release, { recursive: true, force: true });
mkdirSync(release, { recursive: true });
run('npm', ['run', 'lint']);
run('npm', ['run', 'test']);
run('npm', ['run', 'build']);

const manifest = JSON.parse(readFileSync(resolve(root, 'dist', 'manifest.json'), 'utf8'));
if (manifest.version !== '0.1.0' || manifest.manifest_version !== 3) throw new Error('Manifest version validation failed');
if (JSON.stringify(manifest.permissions ?? []) !== JSON.stringify(['storage'])) throw new Error('Manifest permissions are not minimal');
if (JSON.stringify(manifest.content_scripts?.[0]?.matches) !== JSON.stringify(['https://chatgpt.com/*'])) throw new Error('Manifest host scope validation failed');

const files = readdirSync(resolve(root, 'dist'), { recursive: true }).map(String);
const forbiddenNames = files.filter((file) => /(^|\/)(\.env|node_modules|.*\.(map|pem|key|cookie))$/i.test(file));
if (forbiddenNames.length) throw new Error(`Forbidden release files: ${forbiddenNames.join(', ')}`);
for (const file of files) {
  const path = resolve(root, 'dist', file);
  if (statSync(path).isDirectory()) continue;
  const content = readFileSync(path, 'utf8');
  if (/(^|[^A-Za-z])sk-[A-Za-z0-9_-]{20,}|BEGIN (RSA |EC )?PRIVATE KEY/.test(content)) throw new Error(`Sensitive content in ${file}`);
}

execFileSync('zip', ['-q', '-r', archive, '.'], { cwd: resolve(root, 'dist'), stdio: 'inherit' });
const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
const size = statSync(archive).size;
process.stdout.write(`PointAsk 0.1.0\nArchive: ${archive}\nFiles: ${files.length}\nBytes: ${size}\nSHA-256: ${sha256}\n`);
