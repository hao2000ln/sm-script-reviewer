export type ScFileFixtureClassification =
  | 'confirmed-valid'
  | 'confirmed-invalid'
  | 'contract-dependent'
  | 'unknown';

export interface ScFileContractFixture {
  readonly name: string;
  readonly classification: ScFileFixtureClassification;
  readonly source: string;
}

/** Acceptance corpus: classification is contract evidence, not a diagnostic. */
export const SCFILE_CONTRACT_FIXTURES: readonly ScFileContractFixture[] = [
  { name: 'readonly-select', classification: 'confirmed-valid', source: 'var f = new SCFile("contacts", SCFILE_READONLY); f.doSelect("true");' },
  { name: 'readonly-fields-select', classification: 'confirmed-valid', source: 'var f = new SCFile("contacts", SCFILE_READONLY); f.setFields("contact.name user.id"); f.doSelect("true");' },
  { name: 'readonly-update', classification: 'confirmed-invalid', source: 'var f = new SCFile("contacts", SCFILE_READONLY); f.doUpdate();' },
  { name: 'readonly-insert', classification: 'confirmed-invalid', source: 'var f = new SCFile("contacts", SCFILE_READONLY); f.doInsert();' },
  { name: 'readonly-delete', classification: 'confirmed-invalid', source: 'var f = new SCFile("contacts", SCFILE_READONLY); f.doDelete();' },
  { name: 'readonly-remove', classification: 'unknown', source: 'var f = new SCFile("contacts", SCFILE_READONLY); f.doRemove();' },
  { name: 'normal-fields', classification: 'confirmed-invalid', source: 'var f = new SCFile("contacts"); f.setFields("contact.name");' },
  { name: 'fields-number', classification: 'confirmed-invalid', source: 'var f = new SCFile("contacts", SCFILE_READONLY); f.setFields(1);' },
  { name: 'fields-reset', classification: 'confirmed-valid', source: 'var f = new SCFile("contacts", SCFILE_READONLY); f.setFields("contact.name"); f.setFields();' },
  { name: 'field-outside-selection', classification: 'contract-dependent', source: 'var f = new SCFile("contacts", SCFILE_READONLY); f.setFields("contact.name"); f.doSelect("true"); print(f.user_id);' },
  { name: 'readonly-without-fields', classification: 'confirmed-valid', source: 'var f = new SCFile("contacts", SCFILE_READONLY); f.doSelect("true");' },
  { name: 'readonly-alias-write', classification: 'confirmed-invalid', source: 'var f = new SCFile("contacts", SCFILE_READONLY); var alias = f; alias.doUpdate();' },
  { name: 'dynamic-mode', classification: 'unknown', source: 'var f = new SCFile("contacts", getMode()); f.doSelect("true");' },
  { name: 'reassignment-after-alias', classification: 'unknown', source: 'var f = new SCFile("contacts", SCFILE_READONLY); var alias = f; alias = getUnknown(); alias.doUpdate();' },
  { name: 'conditional-call', classification: 'contract-dependent', source: 'var f = new SCFile("contacts", SCFILE_READONLY); if (shouldWrite) f.doUpdate();' },
  { name: 'nested-reference', classification: 'unknown', source: 'var f = new SCFile("contacts", SCFILE_READONLY); function later() { f.doUpdate(); }' },
];
