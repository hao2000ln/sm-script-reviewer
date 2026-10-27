import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export interface AIEnvironmentConfiguration {
  readonly apiKey?: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly timeoutMs?: string;
}

const SUPPORTED_VARIABLES = {
  apiKey: 'SM_REVIEWER_AI_API_KEY',
  model: 'SM_REVIEWER_AI_MODEL',
  endpoint: 'SM_REVIEWER_AI_ENDPOINT',
  timeoutMs: 'SM_REVIEWER_AI_TIMEOUT_MS',
} as const;

export async function loadAIEnvironmentConfiguration(
  workingDirectory = process.cwd(),
): Promise<AIEnvironmentConfiguration> {
  let fileValues: Record<string, string | undefined> = {};
  try {
    fileValues = parseEnv(await readFile(resolve(workingDirectory, '.env'), 'utf8'));
  } catch (error) {
    if (!isMissingFile(error)) {
      throw new Error('Cannot load .env configuration');
    }
  }

  return Object.fromEntries(
    Object.entries(SUPPORTED_VARIABLES).flatMap(([property, variable]) => {
      const value = process.env[variable] ?? fileValues[variable];
      return value === undefined ? [] : [[property, value]];
    }),
  ) as AIEnvironmentConfiguration;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT';
}
