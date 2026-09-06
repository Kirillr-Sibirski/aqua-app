/**
 * Server-only deployments loader (route handlers, scripts, tests). Do NOT import from client code.
 *
 * Resolution order: explicit `file` arg → env DEPLOYMENTS_FILE → `<cwd>/public/deployments/local.json`
 * → NEXT_PUBLIC_* env fallback.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { deploymentsFromEnv, DeploymentsError, parseDeployments, type LoadedDeployments } from './deployments';

export const DEFAULT_DEPLOYMENTS_FILE = path.join('public', 'deployments', 'local.json');

export function resolveDeploymentsFile(file?: string): string {
  const p = file ?? process.env.DEPLOYMENTS_FILE ?? DEFAULT_DEPLOYMENTS_FILE;
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

export async function loadDeploymentsFromFile(file?: string): Promise<LoadedDeployments> {
  const resolved = resolveDeploymentsFile(file);
  let fileError: string;
  try {
    const text = await readFile(resolved, 'utf8');
    return { deployments: parseDeployments(JSON.parse(text)), source: 'file', url: resolved };
  } catch (e) {
    fileError = e instanceof Error ? e.message : String(e);
  }
  try {
    return { deployments: deploymentsFromEnv(), source: 'env', url: resolved, fileError };
  } catch (e) {
    const envError = e instanceof Error ? e.message : String(e);
    throw new DeploymentsError(`Could not read ${resolved} (${fileError}); env fallback failed (${envError})`);
  }
}
