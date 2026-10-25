import ts from 'typescript';
import type { SourceDocument, AnalysisResult, FunctionInfo, CommentInfo, SourceLocation } from '../core/types';
export function analyze(source: SourceDocument): AnalysisResult {
  const ast = ts.createSourceFile(source.filePath, source.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const loc = (offset: number): SourceLocation => { const p = ast.getLineAndCharacterOfPosition(offset); return { line: p.line + 1, column: p.character + 1 }; };
  const comments: CommentInfo[] = [];
  // TS scanner handles comments without treating comment-like text inside strings as comments.
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source.content);
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      const start = scanner.getTokenPos(), end = scanner.getTextPos();
      comments.push({kind: token === ts.SyntaxKind.SingleLineCommentTrivia ? 'line':'block', text: source.content.slice(start,end), start:loc(start),end:loc(end)});
    }
    token = scanner.scan();
  }
  const functions: FunctionInfo[] = [];
  function visit(node: ts.Node) {
    const isFunction = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
    if (isFunction) {
      let name = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ? node.name?.text : ts.isMethodDeclaration(node) ? node.name.getText(ast) : undefined;
      if (!name && node.parent && ts.isVariableDeclaration(node.parent)) name = node.parent.name.getText(ast);
      if (!name && node.parent && ts.isPropertyAssignment(node.parent)) name = node.parent.name.getText(ast);
      const start = node.getStart(ast);
      const preceding = comments.filter(c => c.end.line < loc(start).line && source.content.slice(ast.getPositionOfLineAndCharacter(c.end.line - 1, c.end.column - 1), start).trim() === '');
      const leading = preceding.at(-1);
      functions.push({ name: name ?? '<anonymous>', kind: ts.SyntaxKind[node.kind], start: loc(start), end: loc(node.getEnd()), leadingComment: leading?.text });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const issues = (ast as ts.SourceFile & {parseDiagnostics: readonly ts.Diagnostic[]}).parseDiagnostics.map((d: ts.Diagnostic) => ({message:ts.flattenDiagnosticMessageText(d.messageText,' '),start:loc(d.start ?? 0)}));
  return {source, functions, comments, issues};
}
