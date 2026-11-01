/** The service admin keys from the root platform.env, so tests can prove none reaches the browser. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SERVICE_KEY_NAMES = ['RAG_ADMIN_API_KEY', 'LOCAL_LLM_ADMIN_API_KEY', 'LLM_GATEWAY_ADMIN_API_KEY'] as const;

export function serviceAdminKeys(): string[] {
  const platformEnvironment = readFileSync(resolve(import.meta.dirname, '../../../../platform.env'), 'utf8');
  return SERVICE_KEY_NAMES.map((name) => {
    const line = platformEnvironment.split('\n').find((candidate) => candidate.startsWith(`${name}=`));
    const value = line?.slice(name.length + 1).trim();
    if (!value) throw new Error(`${name} is missing from platform.env`);
    return value;
  });
}
