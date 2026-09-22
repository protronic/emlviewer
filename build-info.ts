// Build-time metadata injected via Vite `define` (used by vite.config.ts
// and vite.harness.config.ts, surfaced in the app's about dialog).
//
// The git hash comes from EMLVIEWER_GIT_COMMIT when the build has no
// repository access (the dockerised pnpm build in opencloud-compose's
// build-web-extensions.sh mounts only this directory); otherwise it is
// read from the working tree.
import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

function git(command: string): string {
  return execSync(command, {stdio: ['ignore', 'pipe', 'ignore']})
    .toString()
    .trim();
}

function resolveCommit(): string {
  const fromEnv = process.env.EMLVIEWER_GIT_COMMIT?.trim();
  if (fromEnv) return fromEnv;
  try {
    const commit = git('git rev-parse --short=10 HEAD');
    const dirty = git('git status --porcelain -- .');
    return dirty ? `${commit}-dirty` : commit;
  } catch {
    return 'unknown';
  }
}

export function buildInfoDefine(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(resolveCommit()),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  };
}
