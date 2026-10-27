export type SmObjectType = 'SCFile';
export type SmMethodCategory = 'select' | 'cursor' | 'read' | 'write';
export type SmEvidenceStatus = 'official';

export interface SmApiMethodSpec {
  readonly objectType: SmObjectType;
  readonly method: string;
  readonly category: SmMethodCategory;
  readonly returnsCode: boolean;
  readonly evidenceStatus: SmEvidenceStatus;
  readonly documentationUrl: string;
  readonly limitations: string;
}

export const SCFILE_OBJECT_EVIDENCE = Object.freeze({
  status: 'official' as const,
  documentationUrl: 'https://docs.microfocus.com/doc/Service_Manager/9.80/ServiceManagerDefinedJavascriptObjects',
});

const SCFILE_METHODS: readonly SmApiMethodSpec[] = Object.freeze([
  method('doDelete', 'write', 'javascript_method_scfile_dodelete.htm'),
  method('doInsert', 'write', 'javascript_method_scfile_doinsert.htm'),
  method('doSelect', 'select', 'javascript_method_scfile_doselect.htm'),
  method('doUpdate', 'write', 'javascript_method_scfile_doupdate.htm'),
  method('getLastRC', 'read', 'javascript_method_scfile_getlastrc.htm'),
  method('getNext', 'cursor', 'javascript_method_scfile_getnext.htm'),
]);

const BY_NAME = new Map(SCFILE_METHODS.map((spec) => [spec.method, spec]));

export function listScFileMethods(): readonly SmApiMethodSpec[] {
  return SCFILE_METHODS;
}

export function getScFileMethod(methodName: string): SmApiMethodSpec | undefined {
  return BY_NAME.get(methodName);
}

function method(
  methodName: string,
  category: SmMethodCategory,
  document: string,
): SmApiMethodSpec {
  return Object.freeze({
    objectType: 'SCFile',
    method: methodName,
    category,
    returnsCode: true,
    evidenceStatus: 'official',
    documentationUrl: `https://docs.microfocus.com/SM/9.60/Hybrid/Content/programming/javascript/reference/${document}`,
    limitations: 'Official SM 9.60 method evidence is applied only to direct SCFile bindings and supported one-hop aliases; custom wrappers are excluded and target 9.8x behavior still requires UAT.',
  });
}

