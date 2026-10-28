/** Versioned contracts; documentation evidence is not a runtime compatibility claim. */
export type SmObjectType = 'SCFile';
export type SmMethodCategory = 'select' | 'cursor' | 'read' | 'write' | 'configuration';
export type SmEvidenceStatus = 'VERIFIED' | 'PROJECT_VERIFIED' | 'UNKNOWN';
export type SmObjectMode = 'READONLY' | 'READWRITE' | 'UNKNOWN';
export type SmArgumentType = 'string' | 'string-array' | 'number' | 'boolean' | 'object' | 'unknown';

export interface SmApiEvidence {
  readonly status: SmEvidenceStatus;
  readonly source: string;
  readonly documentationUrl: string;
  readonly supportedVersions: readonly string[];
  readonly limitations: string;
}

export interface SmApiMethodSpec extends SmApiEvidence {
  readonly objectType: SmObjectType;
  readonly method: string;
  readonly category: SmMethodCategory;
  readonly returnsCode: boolean;
  /** Kept false until a rule explicitly approves the method for SM-RC-001. */
  readonly returnCodeRuleEligible: boolean;
  readonly allowedArgumentCounts: readonly number[];
  readonly supportedArgumentTypes: readonly (readonly SmArgumentType[])[];
  readonly applicableModes: readonly SmObjectMode[];
}

export interface SmConstructorSpec extends SmApiEvidence {
  readonly objectType: SmObjectType;
  readonly name: 'SCFile';
  readonly allowedArgumentCounts: readonly number[];
  readonly supportedArgumentTypes: readonly (readonly SmArgumentType[])[];
  readonly readonlyModeArgument: 'SCFILE_READONLY';
}

export const SCFILE_OBJECT_EVIDENCE = Object.freeze({
  status: 'VERIFIED' as const,
  source: 'OpenText Service Manager 9.80 Service Manager defined JavaScript objects',
  documentationUrl: 'https://docs.microfocus.com/doc/Service_Manager/9.80/ServiceManagerDefinedJavascriptObjects',
  supportedVersions: ['9.80'] as const,
  limitations: 'Documentation evidence does not replace representative SM 9.8x UAT; custom SCFile wrappers and dynamic constructors are excluded.',
});

export const SCFILE_CONSTRUCTOR: SmConstructorSpec = Object.freeze({
  objectType: 'SCFile',
  name: 'SCFile',
  allowedArgumentCounts: [0, 1, 2] as const,
  supportedArgumentTypes: [[], ['string'], ['object'], ['string', 'number']] as const,
  readonlyModeArgument: 'SCFILE_READONLY',
  ...SCFILE_OBJECT_EVIDENCE,
  source: 'OpenText Service Manager 9.60 JavaScript object: SCFile',
  documentationUrl: 'https://docs.microfocus.com/SM/9.60/Codeless/Content/programming/javascript/reference/javascript_object_scfile.htm',
  supportedVersions: ['9.60'] as const,
  limitations: 'READONLY is recognized only when it is the literal second argument. Non-literal modes, record/structure/array inputs, and 9.8x installation behaviour require UAT.',
});

const SCFILE_METHODS: readonly SmApiMethodSpec[] = Object.freeze([
  method('doDelete', 'write', [], [0]),
  method('doInsert', 'write', [], [0]),
  method('doSelect', 'select', [['string'], ['string', 'unknown']], [1, 2]),
  method('doUpdate', 'write', [], [0]),
  method('getLastRC', 'read', [], [0]),
  method('getNext', 'cursor', [], [0]),
  Object.freeze({
    objectType: 'SCFile' as const,
    method: 'setFields',
    category: 'configuration' as const,
    returnsCode: true,
    returnCodeRuleEligible: false,
    allowedArgumentCounts: [0, 1] as const,
    supportedArgumentTypes: [[], ['string'], ['string-array']] as const,
    applicableModes: ['READONLY'] as const,
    status: 'VERIFIED' as const,
    source: 'OpenText Service Manager 9.80 JavaScript method: SCFile.setFields()',
    documentationUrl: 'https://docs.microfocus.com/doc/Service_Manager/9.80/JavascriptMethodscfilesetfields',
    supportedVersions: ['9.80'] as const,
    limitations: 'Only initialized read-only objects are documented. Literal field names can be indexed; DBDICT validity, aliases, structures, LDAP behaviour, and dynamic arrays remain outside this analyzer.',
  }),
]);

const BY_NAME = new Map(SCFILE_METHODS.map((spec) => [spec.method, spec]));

export function listScFileMethods(): readonly SmApiMethodSpec[] {
  return SCFILE_METHODS;
}

export function getScFileMethod(methodName: string): SmApiMethodSpec | undefined {
  return BY_NAME.get(methodName);
}

/** `doRemove` stays unrecognized: its official 9.52 contract is not 9.8x proof. */
export const SCFILE_UNVERIFIED_API = Object.freeze({
  doRemove: Object.freeze({
    status: 'UNKNOWN' as const,
    source: 'OpenText Service Manager 9.52 JavaScript method: SCFile.doRemove()',
    documentationUrl: 'https://docs.microfocus.com/SM/9.52/Hybrid/Content/programming/javascript/reference/javascript_method_scfile_doremove.htm',
    supportedVersions: ['9.52'] as const,
    limitations: 'Never treated as interchangeable with doDelete until target-version evidence or project UAT is supplied.',
  }),
});

function method(
  methodName: string,
  category: SmMethodCategory,
  supportedArgumentTypes: readonly (readonly SmArgumentType[])[],
  allowedArgumentCounts: readonly number[],
): SmApiMethodSpec {
  const document = `javascript_method_scfile_${methodName.toLowerCase()}.htm`;
  return Object.freeze({
    objectType: 'SCFile',
    method: methodName,
    category,
    returnsCode: true,
    returnCodeRuleEligible: true,
    allowedArgumentCounts,
    supportedArgumentTypes,
    applicableModes: ['READONLY', 'READWRITE', 'UNKNOWN'] as const,
    status: 'VERIFIED',
    source: 'OpenText Service Manager 9.60 SCFile method reference',
    documentationUrl: `https://docs.microfocus.com/SM/9.60/Hybrid/Content/programming/javascript/reference/${document}`,
    supportedVersions: ['9.60'],
    limitations: 'Official 9.60 method evidence is applied only to direct SCFile bindings and supported one-hop aliases; custom wrappers are excluded and target 9.8x behaviour still requires UAT.',
  });
}

