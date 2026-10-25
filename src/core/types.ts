export interface SourceDocument { id: string; filePath: string; content: string; hash: string; }
export interface SourceLocation { line: number; column: number; }
export interface FunctionInfo { name: string; kind: string; start: SourceLocation; end: SourceLocation; leadingComment?: string; }
export interface CommentInfo { kind: 'line'|'block'; text: string; start: SourceLocation; end: SourceLocation; }
export interface ParseIssue { message: string; start: SourceLocation; }
export interface AnalysisResult { source: SourceDocument; functions: FunctionInfo[]; comments: CommentInfo[]; issues: ParseIssue[]; }
