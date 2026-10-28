/* Node regression test cho validation core; không deploy file này thành ScriptLibrary. */
var fs = require("fs");
var vm = require("vm");
var path = require("path");

var root = path.resolve(__dirname, "..");

function loadScript(relativePath, globals) {
  var context = globals || {};
  context.console = console;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
    context,
    { filename: relativePath }
  );
  return context;
}

function assert(name, condition) {
  if (!condition) throw new Error("FAIL: " + name);
  console.log("PASS: " + name);
}

var adapterContext = loadScript("ESD_CORE/ESD_Validation_SM_Adapter.js");
var adapter = {
  readDateTime: adapterContext.readDateTime,
  createDateTime: adapterContext.createDateTime,
  readArray: adapterContext.readArray,
  createArray: adapterContext.createArray
};

var validatorContext = loadScript("ESD_CORE/ESD_Validate_Fields.js", {
  lib: { ESD_Validation_SM_Adapter: adapter }
});
var validators = {
  validateCharacter: validatorContext.validateCharacter,
  validateNumber: validatorContext.validateNumber,
  validateDecimalCharacter: validatorContext.validateDecimalCharacter,
  validateDateTime: validatorContext.validateDateTime,
  validateLogical: validatorContext.validateLogical,
  validateArray: validatorContext.validateArray,
  validatorsList: validatorContext.validatorsList,
  validationProfiles: validatorContext.validationProfiles,
  getValidator: validatorContext.getValidator
};

var engineContext = loadScript("ESD_CORE/ESD_Validation_Engine.js", {
  lib: { ESD_Validate_Fields: validators }
});
var engine = {
  validateFields: engineContext.validateFields,
  applyValidatedValues: engineContext.applyValidatedValues
};

var rulesetContext = loadScript("ESD_CORE/ESD_Validation_Ruleset_Adapter.js", {
  lib: { ESD_Validation_Engine: engine }
});

function MockSCDatum() {
  this.type = null;
  this.items = [];
  this.epoch = null;
}
MockSCDatum.prototype.setType = function (type) { this.type = type; };
MockSCDatum.prototype.getType = function () { return this.type; };
MockSCDatum.prototype.getTime = function () { return this.epoch; };
MockSCDatum.prototype.push = function (value) { this.items.push(value); };
MockSCDatum.prototype.toArray = function () { return this.items.slice(0); };

var smAdapterContext = loadScript("ESD_CORE/ESD_Validation_SM_Adapter.js", {
  SCDatum: MockSCDatum,
  funcs: {
    datemake: function (datum, year, month, day, hour, minute, second) {
      datum.epoch = new Date(year, month - 1, day, hour, minute, second, 0).getTime();
    },
    lng: function (value) { return value.items.length; }
  }
});

var smDate = smAdapterContext.createDateTime(new Date(2026, 9, 19, 10, 30, 0));
assert("SM adapter tạo SCDatum Date/Time type 3",
  smDate.type === 3 && smAdapterContext.readDateTime(smDate).valid === true);

var smArray = smAdapterContext.createArray(["a", "b"]);
var smArrayRead = smAdapterContext.readArray(smArray);
assert("SM adapter tạo và đọc SCDatum Array type 8",
  smArray.type === 8 && smArrayRead.valid && smArrayRead.value.length === 2);

var result = validators.validateCharacter("abc", { maxLenght: 3 });
assert("unknown validator option bị từ chối",
  result.code === "VALIDATOR_CONFIG_UNKNOWN_OPTION");

result = validators.validateCharacter("abc", {
  errorMessages: { requred: "Sai cấu hình" }
});
assert("unknown error message key bị từ chối",
  result.code === "VALIDATOR_CONFIG_UNKNOWN_OPTION");

result = validators.validateNumber("9007199254740993", {});
assert("unsafe integer bị từ chối", result.code === "NUMBER_UNSAFE_INTEGER");

result = validators.validateNumber("0.10000000000000001", {});
assert("decimal mất precision bị từ chối", result.code === "NUMBER_PRECISION_LOSS");

result = validators.validateNumber("1e-999999999", { allowExponent: true });
assert("exponent cực lớn bị chặn trước bước chuẩn hóa",
  result.code === "NUMBER_EXPONENT_OUT_OF_RANGE");

result = validators.validateNumber("9007199254740993", { precisionPolicy: "allow" });
assert("precisionPolicy allow là escape hatch có chủ đích", result.valid === true);

result = validators.validateDecimalCharacter("1.234,50", {
  decimalSeparator: ",",
  groupSeparator: ".",
  maxLength: 7
});
assert("Decimal kiểm tra maxLength trên canonical output",
  result.valid === true && result.value === "1234.50");

result = validators.validateLogical(false, { required: true });
assert("Logical false vẫn hợp lệ khi required", result.valid && result.value === false);

result = validators.validateArray([], {
  required: false,
  elementType: "character",
  elementOptions: { maxLenght: 10 }
});
assert("Array rỗng vẫn kiểm tra elementOptions",
  result.code === "VALIDATOR_CONFIG_UNKNOWN_OPTION");

result = validators.validateArray(["a", "", ""], {
  required: true,
  elementType: "character",
  emptyItemPolicy: "remove",
  maxItems: 1,
  maxInputItems: 3
});
assert("Array tách maxInputItems và maxItems",
  result.valid === true && result.value.length === 1);

var atomicRecord = { first: "  chuẩn hóa  ", second: "" };
result = engine.validateFields(atomicRecord, [
  { field: "first", type: "character", options: { required: true } },
  { field: "second", type: "character", options: { required: true } }
], { mode: "failFast", commit: true });
assert("field lỗi không làm record bị ghi dở",
  result.valid === false && atomicRecord.first === "  chuẩn hóa  ");

var collectRecord = { first: "", second: "" };
result = engine.validateFields(collectRecord, [
  { field: "first", type: "character", options: { required: true } },
  { field: "second", type: "character", options: { required: true } }
], { mode: "collectAll", commit: false });
assert("collectAll trả đủ lỗi", result.errors.length === 2);

var commitRecord = { first: "  hợp lệ  ", second: "ok" };
result = engine.validateFields(commitRecord, [
  { field: "first", type: "character", options: { required: true } },
  { field: "second", type: "character", options: { required: true } }
], { mode: "failFast", commit: true });
assert("commit chỉ chạy sau validation thành công",
  result.valid && result.committed && commitRecord.first === "hợp lệ");

var customRecord = { code: "A01" };
result = engine.validateFields(customRecord, [
  {
    field: "code",
    validator: function () { return { valid: true }; }
  }
], { commit: true });
assert("custom validator không trả value vẫn giữ dữ liệu gốc",
  result.valid && customRecord.code === "A01");

var dateRecord = {
  start: "20/10/2026 10:00",
  end: "19/10/2026 10:00"
};
result = engine.validateFields(dateRecord, [
  {
    field: "start", type: "datetime",
    options: { required: true, mode: "datetime-minute" }
  },
  {
    field: "end", type: "datetime",
    options: { required: true, mode: "datetime-minute" }
  }
], {
  commit: true,
  recordRules: [function (draft) {
    return draft.start.getTime() <= draft.end.getTime()
      ? { valid: true }
      : {
        valid: false,
        field: "end",
        code: "DATE_RANGE_INVALID",
        error: "Ngày kết thúc không hợp lệ."
      };
  }]
});
assert("recordRules chặn commit và trả đúng field",
  !result.valid && result.firstError.field === "end" &&
    dateRecord.start === "20/10/2026 10:00");

var rulesetResult = rulesetContext.toRulesetResult(result);
assert("Ruleset adapter map returnCode/message/cursorPosition",
  rulesetResult.returnCode === 1 && rulesetResult.cursorPosition === "end");

console.log("ALL VALIDATION CORE TESTS PASSED");
