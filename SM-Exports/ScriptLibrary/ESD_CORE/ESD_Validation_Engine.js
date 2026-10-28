/**
 * ScriptLibrary name: ESD_Validation_Engine
 * Điều phối validation nhiều field theo cơ chế stage -> record rules -> commit.
 * Engine không tự xác định record Ruleset và không tự query database.
 */

function _validationEngineHasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function _validationEngineError(code, message, field, extra) {
  var error = {
    field: field || "",
    path: field || "",
    cursorPosition: field || "",
    code: code || "VALIDATION_FAILED",
    error: message || "Dữ liệu không hợp lệ."
  };
  if (extra && typeof extra === "object") {
    for (var key in extra) {
      if (_validationEngineHasOwn(extra, key) && error[key] === undefined) {
        error[key] = extra[key];
      }
    }
  }
  return error;
}

function _validationEngineResult(values, errors, committed) {
  return {
    valid: errors.length === 0,
    values: values,
    errors: errors,
    firstError: errors.length ? errors[0] : null,
    committed: committed === true
  };
}

function _validationEngineUnknownKey(object, allowed) {
  for (var key in object) {
    if (_validationEngineHasOwn(object, key) && allowed.indexOf(key) < 0) return key;
  }
  return null;
}

function _validationEngineResolveValidator(descriptor) {
  if (typeof descriptor.validator === "function") return descriptor.validator;
  if (typeof lib === "undefined" || !lib || !lib.ESD_Validate_Fields ||
      typeof lib.ESD_Validate_Fields.getValidator !== "function") {
    return null;
  }
  return lib.ESD_Validate_Fields.getValidator(descriptor.type);
}

function _validationEngineDraft(record, stagedValues, fields) {
  var draft = {};
  try {
    for (var recordKey in record) {
      if (_validationEngineHasOwn(record, recordKey)) draft[recordKey] = record[recordKey];
    }
  } catch (ignoredRecordEnumerationError) {}
  for (var i = 0; i < fields.length; i++) {
    var field = fields[i].field;
    if (_validationEngineHasOwn(stagedValues, field)) {
      draft[field] = stagedValues[field];
    } else {
      try {
        draft[field] = record[field];
      } catch (ignoredRecordReadError) {
        draft[field] = undefined;
      }
    }
  }
  return draft;
}

function _validationEngineNormalizeError(result, descriptor) {
  var field = descriptor.cursorPosition || descriptor.field;
  var extra = {};
  if (result && typeof result === "object") {
    if (result.index !== undefined) extra.index = result.index;
    if (result.duplicateOf !== undefined) extra.duplicateOf = result.duplicateOf;
    if (result.itemCode !== undefined) extra.itemCode = result.itemCode;
    if (result.itemError !== undefined) extra.itemError = result.itemError;
    if (result.details !== undefined) extra.details = result.details;
  }
  return _validationEngineError(
    result && result.code,
    result && result.error,
    field,
    extra
  );
}

function _validationEngineValidateSchema(record, fields, engineOptions) {
  var errors = [];
  if (!record || typeof record !== "object") {
    errors.push(_validationEngineError(
      "VALIDATION_RECORD_REQUIRED",
      "Phải truyền rõ record cần validate vào Validation Engine.",
      ""
    ));
    return errors;
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    errors.push(_validationEngineError(
      "VALIDATION_SCHEMA_INVALID",
      "Danh sách field validation không hợp lệ.",
      ""
    ));
    return errors;
  }

  var seenFields = {};
  for (var i = 0; i < fields.length; i++) {
    var descriptor = fields[i];
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
      errors.push(_validationEngineError(
        "VALIDATION_SCHEMA_INVALID",
        "Khai báo field thứ " + (i + 1) + " không hợp lệ.",
        ""
      ));
      continue;
    }
    var unknown = _validationEngineUnknownKey(
      descriptor,
      ["field", "type", "validator", "options", "when", "cursorPosition"]
    );
    if (unknown !== null) {
      errors.push(_validationEngineError(
        "VALIDATION_SCHEMA_UNKNOWN_OPTION",
        "Khai báo field có option không hỗ trợ: " + unknown + ".",
        descriptor.field || "",
        { details: { option: unknown } }
      ));
      continue;
    }
    if (typeof descriptor.field !== "string" ||
        descriptor.field.replace(/^\s+|\s+$/g, "") === "" ||
        descriptor.field === "__proto__" || descriptor.field === "constructor" ||
        descriptor.field === "prototype") {
      errors.push(_validationEngineError(
        "VALIDATION_SCHEMA_INVALID_FIELD",
        "Tên field validation không hợp lệ.",
        ""
      ));
      continue;
    }
    if (_validationEngineHasOwn(seenFields, descriptor.field)) {
      errors.push(_validationEngineError(
        "VALIDATION_SCHEMA_DUPLICATE_FIELD",
        "Field \"" + descriptor.field + "\" được khai báo nhiều lần.",
        descriptor.field
      ));
      continue;
    }
    seenFields[descriptor.field] = true;
    if (descriptor.validator === undefined &&
        (typeof descriptor.type !== "string" || descriptor.type === "")) {
      errors.push(_validationEngineError(
        "VALIDATION_SCHEMA_VALIDATOR_REQUIRED",
        "Field \"" + descriptor.field + "\" chưa khai báo validator.",
        descriptor.field
      ));
      continue;
    }
    if (descriptor.validator !== undefined && typeof descriptor.validator !== "function") {
      errors.push(_validationEngineError(
        "VALIDATION_SCHEMA_INVALID_VALIDATOR",
        "Custom validator của \"" + descriptor.field + "\" không hợp lệ.",
        descriptor.field
      ));
      continue;
    }
    if (descriptor.options !== undefined &&
        (!descriptor.options || typeof descriptor.options !== "object" ||
          Array.isArray(descriptor.options))) {
      errors.push(_validationEngineError(
        "VALIDATION_SCHEMA_INVALID_OPTIONS",
        "Options của \"" + descriptor.field + "\" không hợp lệ.",
        descriptor.field
      ));
      continue;
    }
    if (descriptor.when !== undefined && typeof descriptor.when !== "function") {
      errors.push(_validationEngineError(
        "VALIDATION_SCHEMA_INVALID_CONDITION",
        "Điều kiện when của \"" + descriptor.field + "\" không hợp lệ.",
        descriptor.field
      ));
      continue;
    }
    if (descriptor.cursorPosition !== undefined &&
        typeof descriptor.cursorPosition !== "string") {
      errors.push(_validationEngineError(
        "VALIDATION_SCHEMA_INVALID_CURSOR",
        "cursorPosition của \"" + descriptor.field + "\" không hợp lệ.",
        descriptor.field
      ));
      continue;
    }

    var validator = _validationEngineResolveValidator(descriptor);
    if (typeof validator !== "function") {
      errors.push(_validationEngineError(
        "VALIDATION_SCHEMA_VALIDATOR_NOT_FOUND",
        "Không tìm thấy validator \"" + (descriptor.type || "custom") + "\".",
        descriptor.field
      ));
      continue;
    }

    // Primitive validator được probe để phát hiện option sai trước khi đọc dữ liệu.
    if (descriptor.validator === undefined) {
      var probeResult;
      try {
        probeResult = validator(undefined, descriptor.options || {});
      } catch (probeError) {
        probeResult = {
          valid: false,
          code: "VALIDATOR_CONFIG_INVALID",
          error: "Không thể kiểm tra cấu hình validator."
        };
      }
      if (probeResult && (probeResult.code === "VALIDATOR_CONFIG_INVALID" ||
          probeResult.code === "VALIDATOR_CONFIG_UNKNOWN_OPTION")) {
        errors.push(_validationEngineNormalizeError(probeResult, descriptor));
      }
    }
  }

  var recordRules = engineOptions.recordRules;
  if (!Array.isArray(recordRules)) {
    errors.push(_validationEngineError(
      "VALIDATION_ENGINE_CONFIG_INVALID",
      "recordRules phải là một array.",
      ""
    ));
  } else {
    for (var ruleIndex = 0; ruleIndex < recordRules.length; ruleIndex++) {
      var rule = recordRules[ruleIndex];
      var ruleFunction = typeof rule === "function" ? rule : rule && rule.validate;
      if (typeof ruleFunction !== "function") {
        errors.push(_validationEngineError(
          "VALIDATION_RECORD_RULE_INVALID",
          "Record rule thứ " + (ruleIndex + 1) + " không hợp lệ.",
          ""
        ));
        continue;
      }
      if (typeof rule === "object") {
        var unknownRuleOption = _validationEngineUnknownKey(
          rule, ["id", "validate", "field", "cursorPosition"]
        );
        if (unknownRuleOption !== null) {
          errors.push(_validationEngineError(
            "VALIDATION_RECORD_RULE_UNKNOWN_OPTION",
            "Record rule có option không hỗ trợ: " + unknownRuleOption + ".",
            rule.field || "",
            { details: { option: unknownRuleOption } }
          ));
          continue;
        }
        if ((rule.id !== undefined && typeof rule.id !== "string") ||
            (rule.field !== undefined && typeof rule.field !== "string") ||
            (rule.cursorPosition !== undefined && typeof rule.cursorPosition !== "string")) {
          errors.push(_validationEngineError(
            "VALIDATION_RECORD_RULE_INVALID",
            "Metadata của record rule thứ " + (ruleIndex + 1) + " không hợp lệ.",
            rule.field || ""
          ));
        }
      }
    }
  }
  return errors;
}

function applyValidatedValues(record, values) {
  if (!record || typeof record !== "object" || !values || typeof values !== "object") {
    return {
      success: false,
      error: _validationEngineError(
        "VALIDATION_COMMIT_INVALID_ARGUMENT",
        "Record hoặc dữ liệu commit không hợp lệ.",
        ""
      )
    };
  }

  var applied = [];
  var oldValues = {};
  try {
    for (var field in values) {
      if (!_validationEngineHasOwn(values, field)) continue;
      oldValues[field] = record[field];
      record[field] = values[field];
      applied.push(field);
    }
    return { success: true };
  } catch (commitError) {
    for (var i = applied.length - 1; i >= 0; i--) {
      try {
        record[applied[i]] = oldValues[applied[i]];
      } catch (ignoredRollbackError) {}
    }
    return {
      success: false,
      error: _validationEngineError(
        "VALIDATION_COMMIT_FAILED",
        "Không thể ghi dữ liệu đã validate vào record.",
        applied.length ? applied[applied.length - 1] : ""
      )
    };
  }
}

function validateFields(record, fields, options) {
  options = options === undefined ? {} : options;
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return _validationEngineResult({}, [
      _validationEngineError(
        "VALIDATION_ENGINE_CONFIG_INVALID",
        "Cấu hình Validation Engine không hợp lệ.",
        ""
      )
    ], false);
  }
  var unknownOption = _validationEngineUnknownKey(
    options, ["mode", "commit", "recordRules", "context"]
  );
  if (unknownOption !== null) {
    return _validationEngineResult({}, [
      _validationEngineError(
        "VALIDATION_ENGINE_UNKNOWN_OPTION",
        "Validation Engine có option không hỗ trợ: " + unknownOption + ".",
        "",
        { details: { option: unknownOption } }
      )
    ], false);
  }

  var mode = options.mode === undefined ? "failFast" : options.mode;
  var commit = options.commit === undefined ? false : options.commit;
  var recordRules = options.recordRules === undefined ? [] : options.recordRules;
  var context = options.context === undefined ? {} : options.context;
  if ((mode !== "failFast" && mode !== "collectAll") || typeof commit !== "boolean" ||
      !context || typeof context !== "object" || Array.isArray(context)) {
    return _validationEngineResult({}, [
      _validationEngineError(
        "VALIDATION_ENGINE_CONFIG_INVALID",
        "mode, commit hoặc context của Validation Engine không hợp lệ.",
        ""
      )
    ], false);
  }

  var engineOptions = { recordRules: recordRules };
  var schemaErrors = _validationEngineValidateSchema(record, fields, engineOptions);
  if (schemaErrors.length) return _validationEngineResult({}, schemaErrors, false);

  var values = {};
  var errors = [];
  for (var i = 0; i < fields.length; i++) {
    var descriptor = fields[i];
    var draft = _validationEngineDraft(record, values, fields);
    if (descriptor.when) {
      var enabled;
      try {
        enabled = descriptor.when(draft, context) === true;
      } catch (conditionError) {
        errors.push(_validationEngineError(
          "VALIDATION_CONDITION_ERROR",
          "Không thể kiểm tra điều kiện của \"" + descriptor.field + "\".",
          descriptor.cursorPosition || descriptor.field
        ));
        if (mode === "failFast") break;
        continue;
      }
      if (!enabled) continue;
    }

    var validator = _validationEngineResolveValidator(descriptor);
    var result;
    try {
      result = validator(record[descriptor.field], descriptor.options || {}, {
        record: record,
        draft: draft,
        context: context,
        field: descriptor.field
      });
    } catch (validatorError) {
      result = {
        valid: false,
        code: "VALIDATOR_EXECUTION_ERROR",
        error: "Không thể validate trường \"" + descriptor.field + "\"."
      };
    }
    if (!result || result.valid !== true) {
      errors.push(_validationEngineNormalizeError(result, descriptor));
      if (mode === "failFast") break;
      continue;
    }
    // Custom validator có thể chỉ kiểm tra mà không chuẩn hóa. Khi không trả
    // thuộc tính value, giữ nguyên dữ liệu gốc thay vì vô tình ghi undefined.
    values[descriptor.field] = _validationEngineHasOwn(result, "value")
      ? result.value : record[descriptor.field];
  }

  if (errors.length === 0) {
    var normalizedDraft = _validationEngineDraft(record, values, fields);
    for (var ruleIndex = 0; ruleIndex < recordRules.length; ruleIndex++) {
      var ruleDescriptor = recordRules[ruleIndex];
      var ruleFunction = typeof ruleDescriptor === "function"
        ? ruleDescriptor : ruleDescriptor.validate;
      var ruleResult;
      try {
        ruleResult = ruleFunction(normalizedDraft, context, values);
      } catch (ruleError) {
        ruleResult = {
          valid: false,
          code: "VALIDATION_RECORD_RULE_ERROR",
          error: "Không thể thực hiện record rule.",
          field: ruleDescriptor.field || ""
        };
      }
      if (!ruleResult || ruleResult.valid !== true) {
        var ruleErrors = ruleResult && Array.isArray(ruleResult.errors)
          ? ruleResult.errors : [ruleResult || {}];
        for (var errorIndex = 0; errorIndex < ruleErrors.length; errorIndex++) {
          var sourceError = ruleErrors[errorIndex] || {};
          var ruleField = sourceError.cursorPosition || sourceError.field ||
            (ruleDescriptor && ruleDescriptor.cursorPosition) ||
            (ruleDescriptor && ruleDescriptor.field) || "";
          errors.push(_validationEngineError(
            sourceError.code,
            sourceError.error,
            ruleField,
            sourceError.details ? { details: sourceError.details } : null
          ));
          if (mode === "failFast") break;
        }
        if (mode === "failFast") break;
      }
    }
  }

  if (errors.length) return _validationEngineResult(values, errors, false);
  if (!commit) return _validationEngineResult(values, [], false);

  var commitResult = applyValidatedValues(record, values);
  return commitResult.success
    ? _validationEngineResult(values, [], true)
    : _validationEngineResult(values, [commitResult.error], false);
}
