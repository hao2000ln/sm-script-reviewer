/**
 * ScriptLibrary name: ESD_Validation_Ruleset_Adapter
 * Chuyển kết quả Validation Engine sang contract của Ruleset.
 * Caller bắt buộc truyền record; adapter không suy đoán record từ vars.
 */

function toRulesetResult(validationResult) {
  if (!validationResult || typeof validationResult !== "object") {
    return {
      returnCode: 1,
      message: "Kết quả validation không hợp lệ.",
      cursorPosition: "",
      hasError: true,
      errors: []
    };
  }
  var firstError = validationResult.firstError ||
    (validationResult.errors && validationResult.errors.length
      ? validationResult.errors[0] : null);
  return {
    returnCode: validationResult.valid === true ? 0 : 1,
    message: firstError ? firstError.error : "",
    cursorPosition: firstError ? firstError.cursorPosition || firstError.field || "" : "",
    hasError: validationResult.valid !== true,
    errors: validationResult.errors || [],
    values: validationResult.values || {},
    committed: validationResult.committed === true
  };
}

function validateRecord(record, fields, options) {
  if (typeof lib === "undefined" || !lib || !lib.ESD_Validation_Engine ||
      typeof lib.ESD_Validation_Engine.validateFields !== "function") {
    return {
      returnCode: 1,
      message: "ESD_Validation_Engine chưa sẵn sàng.",
      cursorPosition: "",
      hasError: true,
      errors: []
    };
  }
  return toRulesetResult(
    lib.ESD_Validation_Engine.validateFields(record, fields, options || {})
  );
}
