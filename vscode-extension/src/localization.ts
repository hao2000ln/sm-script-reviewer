import type { Finding, RuleMetadata } from '../../src/rules/types';
import type { ReviewDiagnosticData } from './review-adapter';

export type ReviewerLanguage = 'vi' | 'en';
export type ReviewerLanguageSetting = ReviewerLanguage | 'auto';

export function resolveLanguage(setting: ReviewerLanguageSetting, uiLanguage: string): ReviewerLanguage {
  return setting === 'auto' ? (uiLanguage.toLowerCase().startsWith('vi') ? 'vi' : 'en') : setting;
}

export function localizeDiagnostic(
  diagnostic: ReviewDiagnosticData,
  language: ReviewerLanguage,
): ReviewDiagnosticData {
  if (language === 'en' || !diagnostic.finding) return diagnostic;
  const finding = diagnostic.finding;
  return {
    ...diagnostic,
    message: translateFinding(finding) ?? diagnostic.message,
    ...(diagnostic.suggestion ? { suggestion: translateSuggestion(finding) ?? diagnostic.suggestion } : {}),
    evidence: diagnostic.evidence.map((item) => ({ ...item, message: translateEvidence(finding, item.message) ?? item.message })),
  };
}

export function localizeRuleMetadata(metadata: RuleMetadata | undefined, language: ReviewerLanguage): RuleMetadata | undefined {
  if (!metadata || language === 'en') return metadata;
  const translation = RULE_METADATA[metadata.id];
  return translation ? { ...metadata, title: translation.title, description: translation.description } : metadata;
}

function translateFinding(finding: Finding): string | undefined {
  if (finding.ruleId === 'SM-CMT-001') {
    const name = /Function "(.+)" has no leading comment\./u.exec(finding.message)?.[1];
    return name ? `Hàm "${name}" chưa có comment mô tả liền kề phía trước.` : undefined;
  }
  if (finding.ruleId === 'SM-DBG-001') return 'Loại bỏ lệnh print() dùng để debug khỏi mã nguồn production.';
  if (finding.ruleId === 'SM-LOOP-002') return 'Vòng lặp truy vấn SCFile có nhánh tiếp tục nhưng không cập nhật cursor bằng getNext().';
  if (finding.ruleId === 'SM-SCF-001') return 'Kh\u00f4ng th\u1ec3 ghi d\u1eef li\u1ec7u qua SCFile \u0111\u01b0\u1ee3c t\u1ea1o v\u1edbi SCFILE_READONLY.';
  if (finding.ruleId === 'SM-SCF-002') return 'setFields() \u0111\u01b0\u1ee3c g\u1ecdi tr\u00ean SCFile kh\u00f4ng ph\u1ea3i READONLY; vi\u1ec7c ch\u1ecdn fields c\u00f3 th\u1ec3 kh\u00f4ng c\u00f3 hi\u1ec7u l\u1ef1c.';
  if (finding.ruleId === 'SM-SCF-003') return '\u0110\u1ed1i s\u1ed1 setFields() kh\u00f4ng h\u1ee3p l\u1ec7 theo contract SCFile \u0111\u00e3 x\u00e1c minh.';
  if (finding.ruleId === 'SM-SCF-004') return '\u0110\u1ed1i s\u1ed1 constructor SCFile kh\u00f4ng h\u1ee3p l\u1ec7 theo contract \u0111\u00e3 x\u00e1c minh.';
  return undefined;
}

function translateSuggestion(finding: Finding): string | undefined {
  if (finding.ruleId === 'SM-CMT-001') return 'Thêm comment liền kề phía trước để mô tả mục đích của hàm.';
  if (finding.ruleId === 'SM-DBG-001') return 'Xóa print() hoặc thay bằng cơ chế logging đã được phê duyệt.';
  if (finding.ruleId === 'SM-LOOP-002') return 'Cập nhật return code bằng file.getNext() trên mọi nhánh tiếp tục của vòng lặp.';
  if (finding.ruleId === 'SM-SCF-001') return 'D\u00f9ng SCFile writable ri\u00eang sau khi x\u00e1c minh thao t\u00e1c ghi l\u00e0 m\u1ee5c \u0111\u00edch mong mu\u1ed1n.';
  if (finding.ruleId === 'SM-SCF-002') return 'T\u1ea1o object query v\u1edbi SCFILE_READONLY tr\u01b0\u1edbc khi g\u1ecdi setFields(), ho\u1eb7c b\u1ecf setFields() n\u1ebfu mu\u1ed1n l\u1ea5y t\u1ea5t c\u1ea3 fields.';
  if (finding.ruleId === 'SM-SCF-003') return 'D\u00f9ng setFields(), m\u1ed9t chu\u1ed7i t\u00ean field, ho\u1eb7c m\u1ea3ng ch\u1ec9 ch\u1ee9a chu\u1ed7i t\u00ean field.';
  if (finding.ruleId === 'SM-SCF-004') return 'D\u00f9ng new SCFile(), new SCFile(object), ho\u1eb7c new SCFile("table", SCFILE_READONLY).';
  return undefined;
}

function translateEvidence(finding: Finding, message: string): string | undefined {
  if (finding.ruleId === 'SM-CMT-001') return 'Khai báo hàm có tên không có comment dẫn đầu được liên kết.';
  if (finding.ruleId === 'SM-DBG-001') return 'Biểu thức gọi trực tiếp định danh print.';
  if (finding.ruleId === 'SM-LOOP-002') return 'Phân tích control-flow không tìm thấy cập nhật getNext() trên ít nhất một nhánh tiếp tục.';
  if (finding.ruleId === 'SM-SCF-001') return 'L\u1eddi g\u1ecdi ghi d\u1eef li\u1ec7u \u0111\u01b0\u1ee3c li\u00ean k\u1ebft v\u1edbi constructor SCFILE_READONLY.';
  if (finding.ruleId === 'SM-SCF-002') return 'Contract setFields() ch\u1ec9 \u00e1p d\u1ee5ng cho SCFile READONLY \u0111\u00e3 \u0111\u01b0\u1ee3c kh\u1edfi t\u1ea1o.';
  if (finding.ruleId === 'SM-SCF-003') return 'Ki\u1ec3m tra t\u0129nh ch\u1ee9ng minh ki\u1ec3u ho\u1eb7c s\u1ed1 l\u01b0\u1ee3ng \u0111\u1ed1i s\u1ed1 kh\u00f4ng h\u1ee3p l\u1ec7.';
  if (finding.ruleId === 'SM-SCF-004') return 'Ki\u1ec3m tra t\u0129nh ch\u1ee9ng minh ki\u1ec3u ho\u1eb7c s\u1ed1 l\u01b0\u1ee3ng \u0111\u1ed1i s\u1ed1 constructor kh\u00f4ng h\u1ee3p l\u1ec7.';
  return undefined;
}

const RULE_METADATA: Record<string, { title: string; description: string }> = {
  'SM-CMT-001': { title: 'Hàm cần có comment mô tả', description: 'Báo cáo hàm có tên không có comment liền kề phía trước.' },
  'SM-DBG-001': { title: 'Debug output trực tiếp', description: 'Báo cáo lời gọi trực tiếp print() có thể là debug output.' },
  'SM-LOOP-002': { title: 'Vòng lặp truy vấn không tiến cursor', description: 'Báo cáo vòng lặp SCFile thành công không chứng minh được cập nhật cursor.' },
  'SM-SCF-001': { title: 'Ghi d\u1eef li\u1ec7u qua SCFile READONLY', description: 'B\u00e1o c\u00e1o doUpdate(), doInsert() ho\u1eb7c doDelete() tr\u00ean SCFile \u0111\u01b0\u1ee3c t\u1ea1o v\u1edbi SCFILE_READONLY.' },
  'SM-SCF-002': { title: 'setFields tr\u00ean SCFile kh\u00f4ng READONLY', description: 'B\u00e1o c\u00e1o setFields() tr\u00ean SCFile \u0111\u00e3 bi\u1ebft l\u00e0 kh\u00f4ng ph\u1ea3i READONLY.' },
  'SM-SCF-003': { title: '\u0110\u1ed1i s\u1ed1 setFields kh\u00f4ng h\u1ee3p l\u1ec7', description: 'B\u00e1o c\u00e1o ki\u1ec3u ho\u1eb7c s\u1ed1 l\u01b0\u1ee3ng \u0111\u1ed1i s\u1ed1 setFields() sai khi ch\u1ee9ng minh \u0111\u01b0\u1ee3c b\u1eb1ng t\u0129nh.' },
  'SM-SCF-004': { title: '\u0110\u1ed1i s\u1ed1 constructor SCFile kh\u00f4ng h\u1ee3p l\u1ec7', description: 'B\u00e1o c\u00e1o ki\u1ec3u ho\u1eb7c s\u1ed1 l\u01b0\u1ee3ng \u0111\u1ed1i s\u1ed1 constructor sai khi ch\u1ee9ng minh \u0111\u01b0\u1ee3c b\u1eb1ng t\u0129nh.' },
};
