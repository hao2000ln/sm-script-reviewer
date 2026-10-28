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
  return undefined;
}

function translateSuggestion(finding: Finding): string | undefined {
  if (finding.ruleId === 'SM-CMT-001') return 'Thêm comment liền kề phía trước để mô tả mục đích của hàm.';
  if (finding.ruleId === 'SM-DBG-001') return 'Xóa print() hoặc thay bằng cơ chế logging đã được phê duyệt.';
  if (finding.ruleId === 'SM-LOOP-002') return 'Cập nhật return code bằng file.getNext() trên mọi nhánh tiếp tục của vòng lặp.';
  return undefined;
}

function translateEvidence(finding: Finding, message: string): string | undefined {
  if (finding.ruleId === 'SM-CMT-001') return 'Khai báo hàm có tên không có comment dẫn đầu được liên kết.';
  if (finding.ruleId === 'SM-DBG-001') return 'Biểu thức gọi trực tiếp định danh print.';
  if (finding.ruleId === 'SM-LOOP-002') return 'Phân tích control-flow không tìm thấy cập nhật getNext() trên ít nhất một nhánh tiếp tục.';
  return undefined;
}

const RULE_METADATA: Record<string, { title: string; description: string }> = {
  'SM-CMT-001': { title: 'Hàm cần có comment mô tả', description: 'Báo cáo hàm có tên không có comment liền kề phía trước.' },
  'SM-DBG-001': { title: 'Debug output trực tiếp', description: 'Báo cáo lời gọi trực tiếp print() có thể là debug output.' },
  'SM-LOOP-002': { title: 'Vòng lặp truy vấn không tiến cursor', description: 'Báo cáo vòng lặp SCFile thành công không chứng minh được cập nhật cursor.' },
};
