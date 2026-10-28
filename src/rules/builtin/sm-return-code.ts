import type { Rule } from '../types';
import { getSmAnalysis } from '../../sm/analysis';

export const smReturnCodeRule: Rule = {
  metadata: {
    id: 'SM-RC-001',
    title: 'Unhandled SCFile return code',
    description: 'Reports verified SCFile return codes that are discarded or assigned but never observably consumed.',
    classification: 'deterministic',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    syntaxPolicy: 'valid-only',
  },
  run: (context) => getSmAnalysis(context).returnCodes
    .filter(({ status, call }) => status === 'unhandled' && call.methodSpec.returnCodeRuleEligible)
    .map((record) => ({
      message: record.targetName
        ? `Return code from SCFile.${record.call.method}() is assigned to "${record.targetName}" but has no supported observable use.`
        : `Return code from SCFile.${record.call.method}() is discarded.`,
      range: record.call.range,
      evidence: [{
        kind: 'ast',
        message: `Officially cataloged SCFile.${record.call.method}() return-code result is ${record.targetName ? 'assigned but unconsumed' : 'used as an expression statement'}.`,
        range: record.call.range,
      }],
      suggestion: 'Check, return, or pass the result to explicit return-code handling logic.',
    })),
};

