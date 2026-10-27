import { discoverSources, loadSource } from '../source/loader';
import { analyze } from '../parser/analyze';
import { runReviewCommand } from './review-command';

async function main() {
  const [command, target, ...args] = process.argv.slice(2);
  if (command === 'review' && target) {
    try {
      process.exitCode = await runReviewCommand(target, args);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    }
    return;
  }
  if (command !== 'inspect' || !target) {
    console.error('Usage: sm-review <inspect|review> <file-or-folder> [--json]');
    process.exitCode = 2;
    return;
  }
  const files = await discoverSources(target);
  const results = [];
  for (const path of files) {
    try { results.push(analyze(await loadSource(path))); }
    catch (err) { console.error(`Failed ${path}: ${String(err)}`); process.exitCode = 3; }
  }
  if (args.includes('--json')) console.log(JSON.stringify(results,null,2));
  else for (const r of results) {
    console.log(`${r.source.filePath} | functions=${r.functions.length} comments=${r.comments.length} parseIssues=${r.issues.length}`);
    for (const f of r.functions) console.log(`  ${f.start.line}:${f.start.column} ${f.name} (${f.kind}) comment=${Boolean(f.leadingComment)}`);
    for (const issue of r.issues) console.error(`  PARSE ${issue.start.line}:${issue.start.column} ${issue.message}`);
  }
  if (results.some(r=>r.issues.length)) process.exitCode = 1;
}
main().catch(err=>{console.error(err);process.exitCode=3;});
