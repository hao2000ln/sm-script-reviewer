import type { RuleContext } from '../rules/types';
import type { SmAnalysis } from './events';
import { extractSmEvents } from './extract-events';

const CACHE = new WeakMap<RuleContext, SmAnalysis>();

export function getSmAnalysis(context: RuleContext): SmAnalysis {
  const cached = CACHE.get(context);
  if (cached) return cached;
  const analysis = extractSmEvents(context);
  CACHE.set(context, analysis);
  return analysis;
}

