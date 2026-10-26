
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { review } = require("./dist/src/reviewer/review.js");
const { RuleRunner, RuleConfigurationError } =
  require("./dist/src/rules/runner.js");
const { createBuiltinRuleRegistry } =
  require("./dist/src/rules/builtin/index.js");
const { createAnalysisArtifact } =
  require("./dist/src/parser/analysis-artifact.js");

function source(content) {
  return {
    id: "sprint2-acceptance",
    filePath: "sprint2-test.js",
    content,
    hash: createHash("sha256").update(content).digest("hex")
  };
}

function run(content, config) {
  return review(source(content), config);
}

const tests = [
  ["TC01 documented function", () => {
    const r = run("// Documentation\nfunction ok() {}");
    assert.equal(r.findings.length, 0);
  }],

  ["TC02 missing comment", () => {
    const r = run("function missing() {}");
    assert.deepEqual(r.findings.map(f => f.ruleId), ["SM-CMT-001"]);
  }],

  ["TC03 direct print", () => {
    const r = run("// Documented\nfunction ok() { print('debug'); }");
    assert.deepEqual(r.findings.map(f => f.ruleId), ["SM-DBG-001"]);
  }],

  ["TC04 property print excluded", () => {
    assert.equal(run("obj.print('ok');").findings.length, 0);
  }],

  ["TC05 string/comment excluded", () => {
    const r = run("// print('x')\nvar x = \"print('x')\";");
    assert.equal(r.findings.length, 0);
  }],

  ["TC06 multiple findings", () => {
    const r = run("function a() { print(1); }\nfunction b() { print(2); }");
    assert.equal(r.findings.length, 4);
    assert.equal(new Set(r.findings.map(f => f.fingerprint)).size, 4);
  }],

  ["TC07 syntax error skips rules", () => {
    const r = run("function broken( { print('x');");
    assert.ok(r.analysis.issues.length > 0);
    assert.equal(r.findings.length, 0);
    assert.deepEqual(
      r.skippedRules
        .filter(s => s.reason === "syntax-errors")
        .map(s => s.ruleId),
      ["SM-CMT-001", "SM-CODE-001", "SM-DBG-001", "SM-LOOP-001"]
    );
    assert.deepEqual(
      r.skippedRules
        .filter(s => s.reason === "disabled")
        .map(s => s.ruleId),
      ["SM-CMT-002", "SM-CMT-003"]
    );
  }],

  ["TC08 disable rule", () => {
    const r = run("function missing() {}", {
      rules: { "SM-CMT-001": false }
    });
    assert.equal(r.findings.length, 0);
    assert.ok(r.skippedRules.some(s => s.ruleId === "SM-CMT-001"));
  }],

  ["TC09 severity override", () => {
    const r = run("print('debug');", {
      rules: { "SM-DBG-001": { severity: "error" } }
    });
    assert.equal(r.findings[0].severity, "error");
  }],

  ["TC10 unknown rule rejected", () => {
    assert.throws(
      () => run("var x = 1;", {
        rules: { "SM-UNKNOWN": { enabled: true } }
      }),
      RuleConfigurationError
    );
  }],

  ["TC11 invalid severity rejected", () => {
    assert.throws(
      () => run("print(1);", {
        rules: { "SM-DBG-001": { severity: "fatal" } }
      }),
      RuleConfigurationError
    );
  }],

  ["TC12 rule exception isolation", () => {
    const registry = createBuiltinRuleRegistry();
    const faulty = {
      metadata: {
        id: "TEST-FAULT",
        title: "Fault injection",
        description: "Acceptance test",
        classification: "deterministic",
        defaultEnabled: true,
        defaultSeverity: "warning",
        syntaxPolicy: "valid-only"
      },
      run() { throw new Error("Injected failure"); }
    };
    const runner = new RuleRunner(
      new (require("./dist/src/rules/registry.js").RuleRegistry)(
        [...registry.all(), faulty]
      )
    );
    const r = runner.run(createAnalysisArtifact(source("print(1);")));
    assert.ok(r.ruleErrors.some(e => e.ruleId === "TEST-FAULT"));
    assert.ok(r.findings.some(f => f.ruleId === "SM-DBG-001"));
  }],

  ["TC13 deterministic output", () => {
    const code = "function missing() { print(1); }";
    const a = run(code);
    const b = run(code);
    assert.deepEqual(a.findings, b.findings);
    assert.ok(a.findings.every(f => f.evidence.length > 0));
  }],

  ["TC14 unreachable code", () => {
    const r = run("// Documented\nfunction stop() { return true; var value = 1; }");
    assert.deepEqual(r.findings.map(f => f.ruleId), ["SM-CODE-001"]);
  }],

  ["TC15 unconditional loop", () => {
    const r = run("while (true) {}");
    assert.deepEqual(r.findings.map(f => f.ruleId), ["SM-LOOP-001"]);
  }],

  ["TC16 loop with possible exit", () => {
    const r = run("while (true) { if (ready) break; }");
    assert.equal(r.findings.length, 0);
  }],

  ["TC17 opt-in comment heuristics", () => {
    const r = run("// var oldValue = 1;\n// -----", {
      rules: {
        "SM-CMT-002": { enabled: true },
        "SM-CMT-003": { enabled: true }
      }
    });
    assert.deepEqual(
      r.findings.map(f => f.ruleId),
      ["SM-CMT-002", "SM-CMT-003"]
    );
  }]
];

let failed = 0;
for (const [name, test] of tests) {
  try {
    test();
    console.log("PASS", name);
  } catch (error) {
    failed++;
    console.error("FAIL", name, error.message);
  }
}
console.log(`\nResult: ${tests.length - failed}/${tests.length} passed`);
if (failed) process.exitCode = 1;
