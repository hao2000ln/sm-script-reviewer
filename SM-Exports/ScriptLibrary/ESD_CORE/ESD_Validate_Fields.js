/* Các validator trong file này là primitive thuần: không đọc record, không ghi
 * record và không query database. Validation liên trường/commit dữ liệu do
 * ESD_Validation_Engine đảm nhiệm.
 */

function _validationHasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function _validationUnknownKey(object, allowedKeys) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return null;
  for (var key in object) {
    if (_validationHasOwn(object, key) && allowedKeys.indexOf(key) < 0) return key;
  }
  return null;
}

function _validationUnknownOptionResult(fieldName, optionName, scope) {
  var location = scope ? scope + "." + optionName : optionName;
  return {
    valid: false,
    code: "VALIDATOR_CONFIG_UNKNOWN_OPTION",
    error: "Cấu hình trường \"" + fieldName + "\" có option không hỗ trợ: " +
      location + ".",
    details: { option: optionName, path: location }
  };
}

function _validationCheckKnownOptions(options, allowedOptions, allowedMessages, fieldName) {
  var unknownOption = _validationUnknownKey(options, allowedOptions);
  if (unknownOption !== null) {
    return _validationUnknownOptionResult(fieldName, unknownOption, "");
  }
  if (options.errorMessages && typeof options.errorMessages === "object" &&
      !Array.isArray(options.errorMessages)) {
    var unknownMessage = _validationUnknownKey(options.errorMessages, allowedMessages);
    if (unknownMessage !== null) {
      return _validationUnknownOptionResult(fieldName, unknownMessage, "errorMessages");
    }
  }
  return null;
}

function _validationSmAdapter() {
  if (typeof lib !== "undefined" && lib && lib.ESD_Validation_SM_Adapter) {
    return lib.ESD_Validation_SM_Adapter;
  }
  return null;
}

/* Validate DBDict Character (SM type 2).
 *
 * Component như text, textarea, select hoặc radio chỉ quyết định profile
 * options; kiểu dữ liệu nền vẫn phải là Character. Hàm không tự ép number,
 * boolean, array hoặc object thành chuỗi vì việc đó có thể che lỗi mapping.
 * Hàm cũng không escape HTML và không ghi ngược vào record.
 */
function validateCharacter(input, options) {
  options = options === undefined ? {} : options;
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return {
      valid: false,
      code: "VALIDATOR_CONFIG_INVALID",
      error: "Cấu hình kiểm tra dữ liệu Character không hợp lệ."
    };
  }

  var invalidFieldName = options.fieldName !== undefined && options.fieldName !== null &&
    typeof options.fieldName !== "string";
  var fieldName = options.fieldName === undefined || options.fieldName === null ||
    String(options.fieldName).replace(/^\s+|\s+$/g, "") === ""
    ? "dữ liệu" : String(options.fieldName);
  var knownOptionsResult = _validationCheckKnownOptions(
    options,
    ["fieldName", "required", "trim", "collapseWhitespace", "singleLine",
      "caseSensitive", "minLength", "maxLength", "pattern", "allowedValues",
      "errorMessages"],
    ["invalidType", "required", "controlCharacter", "lineBreak", "minLength",
      "maxLength", "pattern", "allowedValues"],
    fieldName
  );
  if (knownOptionsResult) return knownOptionsResult;
  var required = options.required === undefined ? true : options.required;
  var trim = options.trim === undefined ? true : options.trim;
  var collapseWhitespace = options.collapseWhitespace === undefined
    ? false : options.collapseWhitespace;
  var singleLine = options.singleLine === undefined ? false : options.singleLine;
  var caseSensitive = options.caseSensitive === undefined ? true : options.caseSensitive;
  var minLength = options.minLength === undefined ? 0 : options.minLength;
  var maxLength = options.maxLength === undefined ? Infinity : options.maxLength;
  var pattern = options.pattern === undefined ? null : options.pattern;
  var allowedValues = options.allowedValues === undefined ? null : options.allowedValues;
  var errorMessages = options.errorMessages === undefined ? {} : options.errorMessages;

  var invalidBooleanOption = typeof required !== "boolean" || typeof trim !== "boolean" ||
    typeof collapseWhitespace !== "boolean" || typeof singleLine !== "boolean" ||
    typeof caseSensitive !== "boolean";
  var invalidLength = typeof minLength !== "number" || !isFinite(minLength) ||
    minLength < 0 || Math.floor(minLength) !== minLength ||
    typeof maxLength !== "number" || maxLength < 0 ||
    (maxLength !== Infinity && (!isFinite(maxLength) || Math.floor(maxLength) !== maxLength)) ||
    minLength > maxLength;
  var invalidPattern = pattern !== null &&
    Object.prototype.toString.call(pattern) !== "[object RegExp]";
  var invalidAllowedValues = allowedValues !== null && !Array.isArray(allowedValues);
  var invalidMessages = !errorMessages || typeof errorMessages !== "object" ||
    Array.isArray(errorMessages);
  var i;
  if (!invalidAllowedValues && allowedValues !== null) {
    for (i = 0; i < allowedValues.length; i++) {
      if (typeof allowedValues[i] !== "string") {
        invalidAllowedValues = true;
        break;
      }
    }
  }
  if (!invalidMessages) {
    for (var messageKey in errorMessages) {
      if (Object.prototype.hasOwnProperty.call(errorMessages, messageKey) &&
          typeof errorMessages[messageKey] !== "string") {
        invalidMessages = true;
        break;
      }
    }
  }

  if (invalidFieldName || invalidBooleanOption || invalidLength || invalidPattern ||
      invalidAllowedValues || invalidMessages) {
    return {
      valid: false,
      code: "VALIDATOR_CONFIG_INVALID",
      error: "Cấu hình kiểm tra trường \"" + fieldName + "\" không hợp lệ."
    };
  }

  var value = "";
  if (input !== undefined && input !== null) {
    if (typeof input === "string") {
      value = input;
    } else {
      var isSmCharacter = false;
      try {
        isSmCharacter = typeof input.getType === "function" &&
          Number(input.getType()) === 2 && typeof input.getText === "function";
      } catch (ignoredTypeError) {
        isSmCharacter = false;
      }
      if (isSmCharacter) {
        value = String(input.getText());
      } else {
        return {
          valid: false,
          code: "CHAR_INVALID_TYPE",
          error: errorMessages.invalidType ||
            "Trường \"" + fieldName + "\" không đúng kiểu Character."
        };
      }
    }
  }

  if (trim) value = value.replace(/^\s+|\s+$/g, "");

  if (required && value === "") {
    return {
      valid: false,
      code: "CHAR_REQUIRED",
      error: errorMessages.required || "\"" + fieldName + "\" không được để trống."
    };
  }
  if (!required && value === "") return { valid: true, value: "" };

  // Cho phép tab/CR/LF đối với textarea; loại bỏ control character còn lại.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    return {
      valid: false,
      code: "CHAR_CONTROL_CHARACTER",
      error: errorMessages.controlCharacter ||
        "Trường \"" + fieldName + "\" chứa ký tự điều khiển không hợp lệ."
    };
  }
  if (singleLine && /[\r\n]/.test(value)) {
    return {
      valid: false,
      code: "CHAR_LINE_BREAK_NOT_ALLOWED",
      error: errorMessages.lineBreak ||
        "Trường \"" + fieldName + "\" không được chứa ký tự xuống dòng."
    };
  }

  if (collapseWhitespace) {
    value = singleLine
      ? value.replace(/\s+/g, " ")
      : value.replace(/[\t\f\v ]+/g, " ");
  }

  if (value.length < minLength) {
    return {
      valid: false,
      code: "CHAR_MIN_LENGTH",
      error: errorMessages.minLength ||
        "Độ dài của \"" + fieldName + "\" phải từ " + minLength + " ký tự trở lên."
    };
  }
  if (value.length > maxLength) {
    return {
      valid: false,
      code: "CHAR_MAX_LENGTH",
      error: errorMessages.maxLength ||
        "Độ dài tối đa của \"" + fieldName + "\" là " + maxLength + " ký tự."
    };
  }

  if (pattern) {
    pattern.lastIndex = 0;
    var matchesPattern = pattern.test(value);
    pattern.lastIndex = 0;
    if (!matchesPattern) {
      return {
        valid: false,
        code: "CHAR_PATTERN_MISMATCH",
        error: errorMessages.pattern ||
          "Giá trị của \"" + fieldName + "\" không đúng định dạng yêu cầu."
      };
    }
  }

  if (allowedValues !== null) {
    var comparableValue = caseSensitive ? value : value.toLowerCase();
    var allowed = false;
    for (i = 0; i < allowedValues.length; i++) {
      var comparableAllowed = caseSensitive
        ? allowedValues[i] : allowedValues[i].toLowerCase();
      if (comparableValue === comparableAllowed) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      return {
        valid: false,
        code: "CHAR_VALUE_NOT_ALLOWED",
        error: errorMessages.allowedValues ||
          "Giá trị của \"" + fieldName + "\" không nằm trong danh sách cho phép."
      };
    }
  }

  return { valid: true, value: value };
}

// Parser nội bộ dùng chung; chỉ chuẩn hóa cú pháp, chưa chuyển sang JavaScript Number.
function _parseNumericText(value, decimalSeparator, groupSeparator, allowExponent) {
  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  var escapedDecimal = escapeRegExp(decimalSeparator);
  var integerPattern = "\\d+";
  if (groupSeparator !== null) {
    var escapedGroup = escapeRegExp(groupSeparator);
    integerPattern = "(?:\\d{1,3}(?:" + escapedGroup + "\\d{3})+|\\d+)";
  }
  var mantissaPattern = "(?:" + integerPattern + "(?:" + escapedDecimal +
    "\\d+)?|" + escapedDecimal + "\\d+)";
  var exponentPattern = allowExponent ? "(?:[eE][+\\-]?\\d+)?" : "";
  var numberPattern = new RegExp("^[+\\-]?" + mantissaPattern + exponentPattern + "$");
  if (!numberPattern.test(value)) return { valid: false };

  var normalized = value;
  if (groupSeparator !== null) normalized = normalized.split(groupSeparator).join("");
  if (decimalSeparator !== ".") normalized = normalized.replace(decimalSeparator, ".");
  return { valid: true, value: normalized };
}

// Chuẩn hóa decimal không exponent thành sign/integer/fraction để so sánh chính xác.
function _normalizeDecimalText(value) {
  var negative = value.charAt(0) === "-";
  var unsigned = /^[+\-]/.test(value) ? value.substring(1) : value;
  var dotIndex = unsigned.indexOf(".");
  var integerDigits = dotIndex < 0 ? unsigned : unsigned.substring(0, dotIndex);
  var fractionDigits = dotIndex < 0 ? "" : unsigned.substring(dotIndex + 1);
  integerDigits = integerDigits.replace(/^0+(?=\d)/, "");
  if (integerDigits === "") integerDigits = "0";

  var isZero = integerDigits === "0" && !/[1-9]/.test(fractionDigits);
  if (isZero) negative = false;
  return {
    negative: negative,
    integerDigits: integerDigits,
    fractionDigits: fractionDigits,
    isZero: isZero
  };
}

// So sánh hai decimal đã chuẩn hóa mà không dùng floating point.
function _compareDecimalValues(left, right) {
  if (left.isZero && right.isZero) return 0;
  if (left.negative !== right.negative) return left.negative ? -1 : 1;

  var absoluteComparison = 0;
  if (left.integerDigits.length !== right.integerDigits.length) {
    absoluteComparison = left.integerDigits.length < right.integerDigits.length ? -1 : 1;
  } else if (left.integerDigits !== right.integerDigits) {
    absoluteComparison = left.integerDigits < right.integerDigits ? -1 : 1;
  } else {
    var fractionLength = Math.max(left.fractionDigits.length, right.fractionDigits.length);
    var leftFraction = left.fractionDigits;
    var rightFraction = right.fractionDigits;
    while (leftFraction.length < fractionLength) leftFraction += "0";
    while (rightFraction.length < fractionLength) rightFraction += "0";
    if (leftFraction !== rightFraction) {
      absoluteComparison = leftFraction < rightFraction ? -1 : 1;
    }
  }
  return left.negative ? -absoluteComparison : absoluteComparison;
}

// Chuẩn hóa cả dạng exponent để phát hiện việc JavaScript Number làm đổi giá trị.
function _canonicalNumericText(value) {
  var match = /^([+\-]?)(\d*)(?:\.(\d*))?(?:[eE]([+\-]?\d+))?$/.exec(value);
  if (!match || (match[2] === "" && match[3] === "")) return null;

  var negative = match[1] === "-";
  var integerDigits = match[2] || "";
  var fractionDigits = match[3] || "";
  var exponent = match[4] === undefined ? 0 : parseInt(match[4], 10);
  if (!isFinite(exponent) || Math.abs(exponent) > 1000) return null;
  var digits = integerDigits + fractionDigits;
  var decimalPosition = integerDigits.length + exponent;

  if (decimalPosition <= 0) {
    digits = new Array(1 - decimalPosition).join("0") + digits;
    decimalPosition = 0;
  } else if (decimalPosition >= digits.length) {
    digits += new Array(decimalPosition - digits.length + 1).join("0");
  }

  integerDigits = decimalPosition === 0 ? "0" : digits.substring(0, decimalPosition);
  fractionDigits = digits.substring(decimalPosition);
  integerDigits = integerDigits.replace(/^0+(?=\d)/, "");
  fractionDigits = fractionDigits.replace(/0+$/, "");
  if (integerDigits === "") integerDigits = "0";
  var isZero = integerDigits === "0" && fractionDigits === "";
  return (negative && !isZero ? "-" : "") + integerDigits +
    (fractionDigits === "" ? "" : "." + fractionDigits);
}

function _isUnsafeIntegerCanonical(value) {
  var unsigned = value.charAt(0) === "-" ? value.substring(1) : value;
  if (unsigned.indexOf(".") >= 0) return false;
  unsigned = unsigned.replace(/^0+(?=\d)/, "");
  var safeLimit = "9007199254740991";
  return unsigned.length > safeLimit.length ||
    (unsigned.length === safeLimit.length && unsigned > safeLimit);
}

/* Validate DBDict Number (SM type 1).
 *
 * Chấp nhận JavaScript number, chuỗi số từ UI hoặc SCDatum Number. Chuỗi được
 * phân tích theo separator đã khai báo; không dùng Number(input) trực tiếp vì
 * boolean, chuỗi rỗng và định dạng tiền không rõ ràng có thể bị ép kiểu sai.
 */
function validateNumber(input, options) {
  options = options === undefined ? {} : options;
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return {
      valid: false,
      code: "VALIDATOR_CONFIG_INVALID",
      error: "Cấu hình kiểm tra dữ liệu Number không hợp lệ."
    };
  }

  var invalidFieldName = options.fieldName !== undefined && options.fieldName !== null &&
    typeof options.fieldName !== "string";
  var fieldName = options.fieldName === undefined || options.fieldName === null ||
    String(options.fieldName).replace(/^\s+|\s+$/g, "") === ""
    ? "dữ liệu" : String(options.fieldName);
  var knownOptionsResult = _validationCheckKnownOptions(
    options,
    ["fieldName", "required", "trim", "allowNumericString", "allowExponent",
      "integerOnly", "safeIntegerOnly", "precisionPolicy", "minInclusive",
      "maxInclusive", "min", "max", "maxDecimalPlaces", "decimalSeparator",
      "groupSeparator", "maxInputLength", "maxExponent", "errorMessages"],
    ["invalidType", "required", "invalidFormat", "notFinite", "integerOnly",
      "safeIntegerOnly", "precisionLoss", "maxDecimalPlaces", "inputTooLong",
      "exponent", "min", "max"],
    fieldName
  );
  if (knownOptionsResult) return knownOptionsResult;
  var required = options.required === undefined ? true : options.required;
  var trim = options.trim === undefined ? true : options.trim;
  var allowNumericString = options.allowNumericString === undefined
    ? true : options.allowNumericString;
  var allowExponent = options.allowExponent === undefined ? false : options.allowExponent;
  var integerOnly = options.integerOnly === undefined ? false : options.integerOnly;
  var safeIntegerOnly = options.safeIntegerOnly === undefined
    ? false : options.safeIntegerOnly;
  var precisionPolicy = options.precisionPolicy === undefined
    ? "reject" : options.precisionPolicy;
  var minInclusive = options.minInclusive === undefined ? true : options.minInclusive;
  var maxInclusive = options.maxInclusive === undefined ? true : options.maxInclusive;
  var min = options.min === undefined ? -Infinity : options.min;
  var max = options.max === undefined ? Infinity : options.max;
  var maxDecimalPlaces = options.maxDecimalPlaces === undefined
    ? null : options.maxDecimalPlaces;
  var decimalSeparator = options.decimalSeparator === undefined
    ? "." : options.decimalSeparator;
  var groupSeparator = options.groupSeparator === undefined
    ? null : options.groupSeparator;
  var maxInputLength = options.maxInputLength === undefined
    ? 256 : options.maxInputLength;
  var maxExponent = options.maxExponent === undefined ? 324 : options.maxExponent;
  var errorMessages = options.errorMessages === undefined ? {} : options.errorMessages;

  var invalidBooleanOption = typeof required !== "boolean" || typeof trim !== "boolean" ||
    typeof allowNumericString !== "boolean" || typeof allowExponent !== "boolean" ||
    typeof integerOnly !== "boolean" || typeof safeIntegerOnly !== "boolean" ||
    typeof minInclusive !== "boolean" || typeof maxInclusive !== "boolean";
  var invalidPrecisionPolicy = precisionPolicy !== "reject" && precisionPolicy !== "allow";
  var invalidRange = typeof min !== "number" || isNaN(min) ||
    typeof max !== "number" || isNaN(max) || min > max;
  var invalidDecimalPlaces = maxDecimalPlaces !== null &&
    (typeof maxDecimalPlaces !== "number" || !isFinite(maxDecimalPlaces) ||
      maxDecimalPlaces < 0 || Math.floor(maxDecimalPlaces) !== maxDecimalPlaces);
  var invalidInputLimit = typeof maxInputLength !== "number" ||
    !isFinite(maxInputLength) || maxInputLength <= 0 ||
    Math.floor(maxInputLength) !== maxInputLength ||
    typeof maxExponent !== "number" || !isFinite(maxExponent) ||
    maxExponent < 0 || Math.floor(maxExponent) !== maxExponent || maxExponent > 1000;
  var invalidDecimalSeparator = typeof decimalSeparator !== "string" ||
    decimalSeparator.length !== 1 || /[0-9+\-eE\s]/.test(decimalSeparator);
  var invalidGroupSeparator = groupSeparator !== null &&
    (typeof groupSeparator !== "string" || groupSeparator.length !== 1 ||
      /[0-9+\-eE]/.test(groupSeparator));
  var invalidMessages = !errorMessages || typeof errorMessages !== "object" ||
    Array.isArray(errorMessages);
  if (!invalidMessages) {
    for (var messageKey in errorMessages) {
      if (Object.prototype.hasOwnProperty.call(errorMessages, messageKey) &&
          typeof errorMessages[messageKey] !== "string") {
        invalidMessages = true;
        break;
      }
    }
  }

  if (groupSeparator !== null && groupSeparator === decimalSeparator) {
    invalidGroupSeparator = true;
  }
  if (safeIntegerOnly && !integerOnly) {
    invalidBooleanOption = true;
  }
  if (invalidFieldName || invalidBooleanOption || invalidPrecisionPolicy || invalidRange || invalidDecimalPlaces || invalidInputLimit ||
      invalidDecimalSeparator || invalidGroupSeparator || invalidMessages) {
    return {
      valid: false,
      code: "VALIDATOR_CONFIG_INVALID",
      error: "Cấu hình kiểm tra trường \"" + fieldName + "\" không hợp lệ."
    };
  }

  function decimalPlacesOf(normalizedText) {
    var unsigned = normalizedText.replace(/^[+\-]/, "");
    var exponentParts = unsigned.split(/[eE]/);
    var mantissa = exponentParts[0];
    var exponent = exponentParts.length > 1 ? parseInt(exponentParts[1], 10) : 0;
    var dotIndex = mantissa.indexOf(".");
    var fractionLength = dotIndex < 0 ? 0 : mantissa.length - dotIndex - 1;
    return Math.max(0, fractionLength - exponent);
  }

  var rawValue = input;
  var fromSmNumber = false;
  if (input !== undefined && input !== null && typeof input === "object") {
    try {
      var smType = typeof input.getType === "function" ? input.getType() : null;
      fromSmNumber = (Number(smType) === 1 || String(smType).toUpperCase() === "NUMBER") &&
        typeof input.getText === "function";
      if (fromSmNumber) rawValue = input.getText();
    } catch (ignoredNumberTypeError) {
      fromSmNumber = false;
    }
    if (!fromSmNumber) {
      return {
        valid: false,
        code: "NUMBER_INVALID_TYPE",
        error: errorMessages.invalidType ||
          "Trường \"" + fieldName + "\" không đúng kiểu Number."
      };
    }
  }

  var empty = rawValue === undefined || rawValue === null;
  if (typeof rawValue === "string") {
    if (trim) rawValue = rawValue.replace(/^\s+|\s+$/g, "");
    empty = rawValue === "";
  }
  if (empty) {
    if (required) {
      return {
        valid: false,
        code: "NUMBER_REQUIRED",
        error: errorMessages.required || "\"" + fieldName + "\" không được để trống."
      };
    }
    return { valid: true, value: null };
  }
  if (typeof rawValue === "string" && rawValue.length > maxInputLength) {
    return {
      valid: false,
      code: "NUMBER_INPUT_TOO_LONG",
      error: errorMessages.inputTooLong ||
        "Dữ liệu nhập của \"" + fieldName + "\" vượt giới hạn an toàn."
    };
  }

  var numberValue;
  var normalizedText;
  var canonicalInput = null;
  if (typeof rawValue === "number") {
    numberValue = rawValue;
    normalizedText = String(rawValue);
    canonicalInput = _canonicalNumericText(normalizedText);
  } else if (typeof rawValue === "string") {
    if (!allowNumericString && !fromSmNumber) {
      return {
        valid: false,
        code: "NUMBER_INVALID_TYPE",
        error: errorMessages.invalidType ||
          "Trường \"" + fieldName + "\" không đúng kiểu Number."
      };
    }

    var parsedNumber = _parseNumericText(
      rawValue, decimalSeparator, groupSeparator, allowExponent
    );
    if (!parsedNumber.valid) {
      return {
        valid: false,
        code: "NUMBER_INVALID_FORMAT",
        error: errorMessages.invalidFormat ||
          "Giá trị của \"" + fieldName + "\" không đúng định dạng số."
      };
    }

    normalizedText = parsedNumber.value;
    var exponentMatch = /[eE]([+\-]?\d+)$/.exec(normalizedText);
    if (exponentMatch && Math.abs(parseInt(exponentMatch[1], 10)) > maxExponent) {
      return {
        valid: false,
        code: "NUMBER_EXPONENT_OUT_OF_RANGE",
        error: errorMessages.exponent ||
          "Số mũ của \"" + fieldName + "\" vượt giới hạn cho phép."
      };
    }
    canonicalInput = _canonicalNumericText(normalizedText);
    numberValue = Number(normalizedText);
  } else {
    return {
      valid: false,
      code: "NUMBER_INVALID_TYPE",
      error: errorMessages.invalidType ||
        "Trường \"" + fieldName + "\" không đúng kiểu Number."
    };
  }

  if (!isFinite(numberValue)) {
    return {
      valid: false,
      code: "NUMBER_NOT_FINITE",
      error: errorMessages.notFinite ||
        "Giá trị của \"" + fieldName + "\" phải là một số hữu hạn."
    };
  }
  if (precisionPolicy === "reject") {
    var canonicalOutput = _canonicalNumericText(String(numberValue));
    if (canonicalInput !== null && _isUnsafeIntegerCanonical(canonicalInput)) {
      return {
        valid: false,
        code: "NUMBER_UNSAFE_INTEGER",
        error: errorMessages.safeIntegerOnly ||
          "Giá trị của \"" + fieldName + "\" vượt phạm vi số nguyên an toàn; " +
            "hãy dùng Decimal Character nếu cần giữ chính xác."
      };
    }
    if (canonicalInput !== null && canonicalOutput !== canonicalInput) {
      return {
        valid: false,
        code: "NUMBER_PRECISION_LOSS",
        error: errorMessages.precisionLoss ||
          "Giá trị của \"" + fieldName + "\" sẽ bị làm tròn khi chuyển sang Number."
      };
    }
  }
  if (integerOnly && Math.floor(numberValue) !== numberValue) {
    return {
      valid: false,
      code: "NUMBER_INTEGER_REQUIRED",
      error: errorMessages.integerOnly ||
        "Trường \"" + fieldName + "\" chỉ chấp nhận số nguyên."
    };
  }
  if (safeIntegerOnly && Math.abs(numberValue) > 9007199254740991) {
    return {
      valid: false,
      code: "NUMBER_UNSAFE_INTEGER",
      error: errorMessages.safeIntegerOnly ||
        "Giá trị của \"" + fieldName + "\" vượt phạm vi số nguyên an toàn."
    };
  }
  if (maxDecimalPlaces !== null && decimalPlacesOf(normalizedText) > maxDecimalPlaces) {
    return {
      valid: false,
      code: "NUMBER_DECIMAL_PLACES_EXCEEDED",
      error: errorMessages.maxDecimalPlaces ||
        "Trường \"" + fieldName + "\" chỉ được có tối đa " +
          maxDecimalPlaces + " chữ số thập phân."
    };
  }
  if (minInclusive ? numberValue < min : numberValue <= min) {
    return {
      valid: false,
      code: "NUMBER_MIN",
      error: errorMessages.min || (minInclusive
        ? "Giá trị của \"" + fieldName + "\" phải lớn hơn hoặc bằng " + min + "."
        : "Giá trị của \"" + fieldName + "\" phải lớn hơn " + min + ".")
    };
  }
  if (maxInclusive ? numberValue > max : numberValue >= max) {
    return {
      valid: false,
      code: "NUMBER_MAX",
      error: errorMessages.max || (maxInclusive
        ? "Giá trị của \"" + fieldName + "\" phải nhỏ hơn hoặc bằng " + max + "."
        : "Giá trị của \"" + fieldName + "\" phải nhỏ hơn " + max + ".")
    };
  }

  // Chuẩn hóa -0 thành 0 để đầu ra ổn định khi ghi xuống DBDict.
  if (numberValue === 0) numberValue = 0;
  return { valid: true, value: numberValue };
}

/* Validate decimal chính xác được lưu trong DBDict Character.
 *
 * Dùng cho tiền và các giá trị thập phân không được phép sai số floating point.
 * Đầu ra luôn là chuỗi canonical dùng dấu chấm thập phân và không có dấu nhóm.
 * Hàm không nhận JavaScript number để tránh nhận một giá trị đã mất độ chính xác.
 */
function validateDecimalCharacter(input, options) {
  options = options === undefined ? {} : options;
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return {
      valid: false,
      code: "VALIDATOR_CONFIG_INVALID",
      error: "Cấu hình kiểm tra Decimal Character không hợp lệ."
    };
  }

  var invalidFieldName = options.fieldName !== undefined && options.fieldName !== null &&
    typeof options.fieldName !== "string";
  var fieldName = options.fieldName === undefined || options.fieldName === null ||
    String(options.fieldName).replace(/^\s+|\s+$/g, "") === ""
    ? "dữ liệu" : String(options.fieldName);
  var knownOptionsResult = _validationCheckKnownOptions(
    options,
    ["fieldName", "required", "trim", "allowNegative", "minInclusive",
      "maxInclusive", "precision", "scale", "maxInputLength", "maxLength",
      "decimalSeparator", "groupSeparator", "min", "max", "errorMessages"],
    ["invalidType", "required", "invalidFormat", "negative", "scale", "precision",
      "maxInputLength", "maxLength", "min", "max"],
    fieldName
  );
  if (knownOptionsResult) return knownOptionsResult;
  var required = options.required === undefined ? true : options.required;
  var trim = options.trim === undefined ? true : options.trim;
  var allowNegative = options.allowNegative === undefined ? true : options.allowNegative;
  var minInclusive = options.minInclusive === undefined ? true : options.minInclusive;
  var maxInclusive = options.maxInclusive === undefined ? true : options.maxInclusive;
  var precision = options.precision === undefined ? null : options.precision;
  var scale = options.scale === undefined ? null : options.scale;
  var maxInputLength = options.maxInputLength === undefined
    ? 10000 : options.maxInputLength;
  var maxLength = options.maxLength === undefined ? Infinity : options.maxLength;
  var decimalSeparator = options.decimalSeparator === undefined
    ? "." : options.decimalSeparator;
  var groupSeparator = options.groupSeparator === undefined
    ? null : options.groupSeparator;
  var min = options.min === undefined ? null : options.min;
  var max = options.max === undefined ? null : options.max;
  var errorMessages = options.errorMessages === undefined ? {} : options.errorMessages;

  var invalidBooleanOption = typeof required !== "boolean" || typeof trim !== "boolean" ||
    typeof allowNegative !== "boolean" || typeof minInclusive !== "boolean" ||
    typeof maxInclusive !== "boolean";
  var invalidPrecision = precision !== null &&
    (typeof precision !== "number" || !isFinite(precision) ||
      precision <= 0 || Math.floor(precision) !== precision);
  var invalidScale = scale !== null &&
    (typeof scale !== "number" || !isFinite(scale) ||
      scale < 0 || Math.floor(scale) !== scale);
  if (!invalidPrecision && !invalidScale && precision !== null && scale !== null &&
      scale > precision) {
    invalidScale = true;
  }
  var invalidMaxInputLength = typeof maxInputLength !== "number" ||
    !isFinite(maxInputLength) || maxInputLength <= 0 ||
    Math.floor(maxInputLength) !== maxInputLength;
  var invalidMaxLength = typeof maxLength !== "number" || maxLength < 0 ||
    (maxLength !== Infinity && (!isFinite(maxLength) || Math.floor(maxLength) !== maxLength));
  var invalidDecimalSeparator = typeof decimalSeparator !== "string" ||
    decimalSeparator.length !== 1 || /[0-9+\-eE\s]/.test(decimalSeparator);
  var invalidGroupSeparator = groupSeparator !== null &&
    (typeof groupSeparator !== "string" || groupSeparator.length !== 1 ||
      /[0-9+\-eE]/.test(groupSeparator));
  if (groupSeparator !== null && groupSeparator === decimalSeparator) {
    invalidGroupSeparator = true;
  }
  var invalidRangeType = (min !== null && typeof min !== "string") ||
    (max !== null && typeof max !== "string");
  var invalidMessages = !errorMessages || typeof errorMessages !== "object" ||
    Array.isArray(errorMessages);
  if (!invalidMessages) {
    for (var messageKey in errorMessages) {
      if (Object.prototype.hasOwnProperty.call(errorMessages, messageKey) &&
          typeof errorMessages[messageKey] !== "string") {
        invalidMessages = true;
        break;
      }
    }
  }

  var minValue = null;
  var maxValue = null;
  var invalidRangeValue = false;
  if (!invalidRangeType) {
    if (min !== null) {
      var parsedMin = _parseNumericText(min, ".", null, false);
      invalidRangeValue = !parsedMin.valid;
      if (parsedMin.valid) minValue = _normalizeDecimalText(parsedMin.value);
    }
    if (!invalidRangeValue && max !== null) {
      var parsedMax = _parseNumericText(max, ".", null, false);
      invalidRangeValue = !parsedMax.valid;
      if (parsedMax.valid) maxValue = _normalizeDecimalText(parsedMax.value);
    }
    if (!invalidRangeValue && minValue !== null && maxValue !== null &&
        _compareDecimalValues(minValue, maxValue) > 0) {
      invalidRangeValue = true;
    }
  }

  if (invalidFieldName || invalidBooleanOption || invalidPrecision || invalidScale ||
      invalidMaxInputLength || invalidMaxLength || invalidDecimalSeparator || invalidGroupSeparator ||
      invalidRangeType || invalidRangeValue || invalidMessages) {
    return {
      valid: false,
      code: "VALIDATOR_CONFIG_INVALID",
      error: "Cấu hình kiểm tra trường \"" + fieldName + "\" không hợp lệ."
    };
  }

  var characterResult = validateCharacter(input, {
    fieldName: fieldName,
    required: required,
    trim: trim,
    singleLine: true,
    maxLength: maxInputLength
  });
  if (!characterResult.valid) {
    if (characterResult.code === "VALIDATOR_CONFIG_INVALID") return characterResult;
    if (characterResult.code === "CHAR_REQUIRED") {
      return {
        valid: false,
        code: "DECIMAL_REQUIRED",
        error: errorMessages.required || "\"" + fieldName + "\" không được để trống."
      };
    }
    if (characterResult.code === "CHAR_INVALID_TYPE") {
      return {
        valid: false,
        code: "DECIMAL_INVALID_TYPE",
        error: errorMessages.invalidType ||
          "Trường \"" + fieldName + "\" phải là Character chứa số thập phân."
      };
    }
    if (characterResult.code === "CHAR_MAX_LENGTH") {
      return {
        valid: false,
        code: "DECIMAL_INPUT_TOO_LONG",
        error: errorMessages.maxInputLength ||
          "Dữ liệu nhập của \"" + fieldName + "\" vượt giới hạn an toàn."
      };
    }
    return {
      valid: false,
      code: "DECIMAL_INVALID_FORMAT",
      error: errorMessages.invalidFormat ||
        "Giá trị của \"" + fieldName + "\" không đúng định dạng decimal."
    };
  }
  if (characterResult.value === "") return { valid: true, value: "" };

  // Decimal Character cố ý không hỗ trợ exponent để dữ liệu lưu dễ đọc và ổn định.
  var parsed = _parseNumericText(
    characterResult.value, decimalSeparator, groupSeparator, false
  );
  if (!parsed.valid) {
    return {
      valid: false,
      code: "DECIMAL_INVALID_FORMAT",
      error: errorMessages.invalidFormat ||
        "Giá trị của \"" + fieldName + "\" không đúng định dạng decimal."
    };
  }

  var decimalValue = _normalizeDecimalText(parsed.value);
  if (!allowNegative && decimalValue.negative) {
    return {
      valid: false,
      code: "DECIMAL_NEGATIVE_NOT_ALLOWED",
      error: errorMessages.negative ||
        "Trường \"" + fieldName + "\" không chấp nhận giá trị âm."
    };
  }
  if (scale !== null && decimalValue.fractionDigits.length > scale) {
    return {
      valid: false,
      code: "DECIMAL_SCALE_EXCEEDED",
      error: errorMessages.scale ||
        "Trường \"" + fieldName + "\" chỉ được có tối đa " + scale +
          " chữ số thập phân."
    };
  }
  if (scale !== null) {
    while (decimalValue.fractionDigits.length < scale) {
      decimalValue.fractionDigits += "0";
    }
  }

  var integerDigitCount = decimalValue.integerDigits === "0" &&
    decimalValue.fractionDigits.length > 0 ? 0 : decimalValue.integerDigits.length;
  var totalDigits = integerDigitCount + decimalValue.fractionDigits.length;
  if (totalDigits === 0) totalDigits = 1;
  if (precision !== null && totalDigits > precision) {
    return {
      valid: false,
      code: "DECIMAL_PRECISION_EXCEEDED",
      error: errorMessages.precision ||
        "Trường \"" + fieldName + "\" vượt quá " + precision + " chữ số cho phép."
    };
  }

  if (minValue !== null) {
    var minComparison = _compareDecimalValues(decimalValue, minValue);
    if (minComparison < 0 || (!minInclusive && minComparison === 0)) {
      return {
        valid: false,
        code: "DECIMAL_MIN",
        error: errorMessages.min || (minInclusive
          ? "Giá trị của \"" + fieldName + "\" phải lớn hơn hoặc bằng " + min + "."
          : "Giá trị của \"" + fieldName + "\" phải lớn hơn " + min + ".")
      };
    }
  }
  if (maxValue !== null) {
    var maxComparison = _compareDecimalValues(decimalValue, maxValue);
    if (maxComparison > 0 || (!maxInclusive && maxComparison === 0)) {
      return {
        valid: false,
        code: "DECIMAL_MAX",
        error: errorMessages.max || (maxInclusive
          ? "Giá trị của \"" + fieldName + "\" phải nhỏ hơn hoặc bằng " + max + "."
          : "Giá trị của \"" + fieldName + "\" phải nhỏ hơn " + max + ".")
      };
    }
  }

  var canonicalValue = (decimalValue.negative ? "-" : "") + decimalValue.integerDigits;
  if (decimalValue.fractionDigits !== "") {
    canonicalValue += "." + decimalValue.fractionDigits;
  }
  if (canonicalValue.length > maxLength) {
    return {
      valid: false,
      code: "DECIMAL_MAX_LENGTH",
      error: errorMessages.maxLength ||
        "Giá trị chuẩn hóa của \"" + fieldName + "\" vượt quá " +
          maxLength + " ký tự."
    };
  }
  return { valid: true, value: canonicalValue };
}

function _normalizeDateTimePrecision(value, mode) {
  var normalized = new Date(value.getTime());
  if (mode === "date") {
    normalized.setHours(0, 0, 0, 0);
  } else if (mode === "datetime-minute") {
    normalized.setSeconds(0, 0);
  } else {
    // DBDict Date/Time có độ chính xác đến giây; không giữ millisecond ẩn.
    normalized.setMilliseconds(0);
  }
  return normalized;
}

function _parseDateTimeText(value, mode) {
  var match = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  var year;
  var month;
  var day;
  var hour;
  var minute;
  var second;
  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
    hour = match[4] === undefined ? 0 : Number(match[4]);
    minute = match[5] === undefined ? 0 : Number(match[5]);
    second = match[6] === undefined ? 0 : Number(match[6]);
  } else {
    match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
    if (!match) return { valid: false, reason: "format" };
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
    hour = match[4] === undefined ? 0 : Number(match[4]);
    minute = match[5] === undefined ? 0 : Number(match[5]);
    second = match[6] === undefined ? 0 : Number(match[6]);
  }

  var hasTime = match[4] !== undefined;
  var hasSecond = match[6] !== undefined;
  if ((mode === "date" && hasTime) ||
      (mode === "datetime-minute" && (!hasTime || hasSecond)) ||
      (mode === "datetime-second" && (!hasTime || !hasSecond))) {
    return { valid: false, reason: "format" };
  }
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return { valid: false, reason: "value" };
  }

  // setFullYear tránh quy tắc JavaScript tự cộng 1900 cho năm từ 00 đến 99.
  var parsed = new Date(0);
  parsed.setFullYear(year, month - 1, day);
  parsed.setHours(hour, minute, second, 0);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day || parsed.getHours() !== hour ||
      parsed.getMinutes() !== minute || parsed.getSeconds() !== second) {
    return { valid: false, reason: "value" };
  }
  return { valid: true, value: parsed };
}

function _readDateTimeValue(input, mode, trim) {
  if (input === undefined || input === null) return { valid: true, empty: true };
  if (typeof input === "string") {
    var text = trim ? input.replace(/^\s+|\s+$/g, "") : input;
    if (text === "") return { valid: true, empty: true };
    var parsedText = _parseDateTimeText(text, mode);
    if (!parsedText.valid) return parsedText;
    return { valid: true, empty: false, value: parsedText.value };
  }

  if (Object.prototype.toString.call(input) === "[object Date]") {
    var dateTime = Number(input.getTime());
    if (!isFinite(dateTime)) return { valid: false, reason: "value" };
    return { valid: true, empty: false, value: new Date(dateTime) };
  }

  if (typeof input === "object") {
    var adapter = _validationSmAdapter();
    if (adapter && typeof adapter.readDateTime === "function") {
      var adapted = adapter.readDateTime(input);
      if (adapted && adapted.valid === true) {
        if (adapted.empty) return { valid: true, empty: true };
        return { valid: true, empty: false, value: adapted.value };
      }
      if (adapted && adapted.reason) return adapted;
    }
    try {
      var smType = typeof input.getType === "function" ? input.getType() : null;
      var typeName = String(smType).toUpperCase();
      var isSmDateTime = Number(smType) === 3 || typeName === "DATETIME" ||
        typeName === "DATE/TIME";
      if (isSmDateTime && typeof input.getTime === "function") {
        var smTime = Number(input.getTime());
        if (!isFinite(smTime)) return { valid: false, reason: "value" };
        return { valid: true, empty: false, value: new Date(smTime) };
      }
    } catch (ignoredDateTimeTypeError) {
      return { valid: false, reason: "type" };
    }
  }
  return { valid: false, reason: "type" };
}

function _createDateTimeValue(value) {
  var adapter = _validationSmAdapter();
  if (adapter && typeof adapter.createDateTime === "function") {
    return adapter.createDateTime(value);
  }
  if (typeof SCDatum === "undefined" || typeof funcs === "undefined" ||
      !funcs || typeof funcs.datemake !== "function") {
    return value;
  }
  var datum = new SCDatum();
  datum.setType(3);
  funcs.datemake(
    datum,
    value.getFullYear(),
    value.getMonth() + 1,
    value.getDate(),
    value.getHours(),
    value.getMinutes(),
    value.getSeconds()
  );
  return datum;
}

function _formatDateTimeForMessage(value, mode) {
  function pad(number) {
    return number < 10 ? "0" + number : String(number);
  }
  var text = pad(value.getDate()) + "/" + pad(value.getMonth() + 1) + "/" +
    value.getFullYear();
  if (mode !== "date") {
    text += " " + pad(value.getHours()) + ":" + pad(value.getMinutes());
    if (mode !== "datetime-minute") text += ":" + pad(value.getSeconds());
  }
  return text;
}

/* Validate DBDict Date/Time (SM type 3).
 * mode: auto | date | datetime-minute | datetime-second.
 * Chuỗi đầu vào dùng dd/MM/yyyy hoặc ISO-local yyyy-MM-dd với phần giờ tương ứng.
 */
function validateDateTime(input, options) {
  options = options === undefined ? {} : options;
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return {
      valid: false,
      code: "VALIDATOR_CONFIG_INVALID",
      error: "Cấu hình kiểm tra dữ liệu Date/Time không hợp lệ."
    };
  }

  var invalidFieldName = options.fieldName !== undefined && options.fieldName !== null &&
    typeof options.fieldName !== "string";
  var fieldName = options.fieldName === undefined || options.fieldName === null ||
    String(options.fieldName).replace(/^\s+|\s+$/g, "") === ""
    ? "dữ liệu" : String(options.fieldName);
  var knownOptionsResult = _validationCheckKnownOptions(
    options,
    ["fieldName", "required", "trim", "mode", "minInclusive", "maxInclusive",
      "min", "max", "errorMessages"],
    ["required", "invalidType", "invalidValue", "invalidFormat", "min", "max"],
    fieldName
  );
  if (knownOptionsResult) return knownOptionsResult;
  var required = options.required === undefined ? true : options.required;
  var trim = options.trim === undefined ? true : options.trim;
  var mode = options.mode === undefined ? "auto" : options.mode;
  var minInclusive = options.minInclusive === undefined ? true : options.minInclusive;
  var maxInclusive = options.maxInclusive === undefined ? true : options.maxInclusive;
  var min = options.min === undefined ? null : options.min;
  var max = options.max === undefined ? null : options.max;
  var errorMessages = options.errorMessages === undefined ? {} : options.errorMessages;

  var invalidBooleanOption = typeof required !== "boolean" || typeof trim !== "boolean" ||
    typeof minInclusive !== "boolean" || typeof maxInclusive !== "boolean";
  var invalidMode = typeof mode !== "string" ||
    (mode !== "auto" && mode !== "date" && mode !== "datetime-minute" &&
      mode !== "datetime-second");
  var invalidMessages = !errorMessages || typeof errorMessages !== "object" ||
    Array.isArray(errorMessages);
  if (!invalidMessages) {
    for (var messageKey in errorMessages) {
      if (Object.prototype.hasOwnProperty.call(errorMessages, messageKey) &&
          typeof errorMessages[messageKey] !== "string") {
        invalidMessages = true;
        break;
      }
    }
  }

  var minDate = null;
  var maxDate = null;
  var invalidRange = false;
  if (!invalidMode) {
    if (min !== null) {
      var minResult = _readDateTimeValue(min, "auto", true);
      invalidRange = !minResult.valid || minResult.empty;
      if (!invalidRange) minDate = _normalizeDateTimePrecision(minResult.value, mode);
    }
    if (!invalidRange && max !== null) {
      var maxResult = _readDateTimeValue(max, "auto", true);
      invalidRange = !maxResult.valid || maxResult.empty;
      if (!invalidRange) maxDate = _normalizeDateTimePrecision(maxResult.value, mode);
    }
    if (!invalidRange && minDate !== null && maxDate !== null &&
        minDate.getTime() > maxDate.getTime()) {
      invalidRange = true;
    }
  }

  if (invalidFieldName || invalidBooleanOption || invalidMode || invalidMessages || invalidRange) {
    return {
      valid: false,
      code: "VALIDATOR_CONFIG_INVALID",
      error: "Cấu hình kiểm tra trường \"" + fieldName + "\" không hợp lệ."
    };
  }

  var inputResult = _readDateTimeValue(input, mode, trim);
  if (inputResult.empty) {
    if (required) {
      return {
        valid: false,
        code: "DATETIME_REQUIRED",
        error: errorMessages.required || "\"" + fieldName + "\" không được để trống."
      };
    }
    return { valid: true, value: null };
  }
  if (!inputResult.valid) {
    if (inputResult.reason === "type") {
      return {
        valid: false,
        code: "DATETIME_INVALID_TYPE",
        error: errorMessages.invalidType ||
          "Trường \"" + fieldName + "\" không đúng kiểu Date/Time."
      };
    }
    if (inputResult.reason === "value") {
      return {
        valid: false,
        code: "DATETIME_INVALID_VALUE",
        error: errorMessages.invalidValue ||
          "Giá trị ngày giờ của \"" + fieldName + "\" không tồn tại."
      };
    }
    return {
      valid: false,
      code: "DATETIME_INVALID_FORMAT",
      error: errorMessages.invalidFormat ||
        "Giá trị của \"" + fieldName + "\" không đúng định dạng ngày giờ."
    };
  }

  var dateValue = _normalizeDateTimePrecision(inputResult.value, mode);
  var timeValue = dateValue.getTime();
  if (minDate !== null) {
    var minTime = minDate.getTime();
    if (timeValue < minTime || (!minInclusive && timeValue === minTime)) {
      return {
        valid: false,
        code: "DATETIME_MIN",
        error: errorMessages.min || (minInclusive
          ? "\"" + fieldName + "\" phải từ " +
            _formatDateTimeForMessage(minDate, mode) + " trở đi."
          : "\"" + fieldName + "\" phải sau " +
            _formatDateTimeForMessage(minDate, mode) + ".")
      };
    }
  }
  if (maxDate !== null) {
    var maxTime = maxDate.getTime();
    if (timeValue > maxTime || (!maxInclusive && timeValue === maxTime)) {
      return {
        valid: false,
        code: "DATETIME_MAX",
        error: errorMessages.max || (maxInclusive
          ? "\"" + fieldName + "\" không được sau " +
            _formatDateTimeForMessage(maxDate, mode) + "."
          : "\"" + fieldName + "\" phải trước " +
            _formatDateTimeForMessage(maxDate, mode) + ".")
      };
    }
  }

  return { valid: true, value: _createDateTimeValue(dateValue) };
}

/* Validate DBDict Logical (SM type 4).
 * false là một giá trị hợp lệ; chỉ null/undefined/chuỗi rỗng mới được coi là rỗng.
 * Giá trị Logical hệ thống "unknown" không thuộc phạm vi input form phổ thông.
 */
function validateLogical(input, options) {
  options = options === undefined ? {} : options;
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return {
      valid: false,
      code: "VALIDATOR_CONFIG_INVALID",
      error: "Cấu hình kiểm tra dữ liệu Logical không hợp lệ."
    };
  }

  var invalidFieldName = options.fieldName !== undefined && options.fieldName !== null &&
    typeof options.fieldName !== "string";
  var fieldName = options.fieldName === undefined || options.fieldName === null ||
    String(options.fieldName).replace(/^\s+|\s+$/g, "") === ""
    ? "dữ liệu" : String(options.fieldName);
  var knownOptionsResult = _validationCheckKnownOptions(
    options,
    ["fieldName", "required", "trim", "caseSensitive", "allowString",
      "allowNumber", "trueValues", "falseValues", "errorMessages"],
    ["required", "invalidType", "invalidValue"],
    fieldName
  );
  if (knownOptionsResult) return knownOptionsResult;
  var required = options.required === undefined ? true : options.required;
  var trim = options.trim === undefined ? true : options.trim;
  var caseSensitive = options.caseSensitive === undefined ? false : options.caseSensitive;
  var allowString = options.allowString === undefined ? true : options.allowString;
  var allowNumber = options.allowNumber === undefined ? true : options.allowNumber;
  var trueValues = options.trueValues === undefined
    ? ["true", "yes", "1"] : options.trueValues;
  var falseValues = options.falseValues === undefined
    ? ["false", "no", "0"] : options.falseValues;
  var errorMessages = options.errorMessages === undefined ? {} : options.errorMessages;

  var invalidBooleanOption = typeof required !== "boolean" || typeof trim !== "boolean" ||
    typeof caseSensitive !== "boolean" || typeof allowString !== "boolean" ||
    typeof allowNumber !== "boolean";
  var invalidValueLists = !Array.isArray(trueValues) || !Array.isArray(falseValues) ||
    trueValues.length === 0 || falseValues.length === 0;
  var invalidMessages = !errorMessages || typeof errorMessages !== "object" ||
    Array.isArray(errorMessages);
  var i;
  if (!invalidValueLists) {
    for (i = 0; i < trueValues.length; i++) {
      if (typeof trueValues[i] !== "string" ||
          normalizeToken(trueValues[i]) === "") {
        invalidValueLists = true;
        break;
      }
    }
    for (i = 0; !invalidValueLists && i < falseValues.length; i++) {
      if (typeof falseValues[i] !== "string" ||
          normalizeToken(falseValues[i]) === "") {
        invalidValueLists = true;
        break;
      }
    }
  }
  if (!invalidMessages) {
    for (var messageKey in errorMessages) {
      if (Object.prototype.hasOwnProperty.call(errorMessages, messageKey) &&
          typeof errorMessages[messageKey] !== "string") {
        invalidMessages = true;
        break;
      }
    }
  }

  function normalizeToken(value) {
    var token = trim ? value.replace(/^\s+|\s+$/g, "") : value;
    return caseSensitive ? token : token.toLowerCase();
  }

  var normalizedTrueValues = [];
  var normalizedFalseValues = [];
  if (!invalidValueLists) {
    for (i = 0; i < trueValues.length; i++) {
      normalizedTrueValues.push(normalizeToken(trueValues[i]));
    }
    for (i = 0; i < falseValues.length; i++) {
      normalizedFalseValues.push(normalizeToken(falseValues[i]));
    }
    for (i = 0; i < normalizedTrueValues.length; i++) {
      if (normalizedFalseValues.indexOf(normalizedTrueValues[i]) >= 0) {
        invalidValueLists = true;
        break;
      }
    }
  }

  if (invalidFieldName || invalidBooleanOption || invalidValueLists || invalidMessages) {
    return {
      valid: false,
      code: "VALIDATOR_CONFIG_INVALID",
      error: "Cấu hình kiểm tra trường \"" + fieldName + "\" không hợp lệ."
    };
  }

  var rawValue = input;
  var fromSmLogical = false;
  if (input !== undefined && input !== null && typeof input === "object") {
    try {
      var smType = typeof input.getType === "function" ? input.getType() : null;
      var typeName = String(smType).toUpperCase();
      fromSmLogical = (Number(smType) === 4 || typeName === "BOOLEAN" ||
        typeName === "LOGICAL") && typeof input.getText === "function";
      if (fromSmLogical) rawValue = input.getText();
    } catch (ignoredLogicalTypeError) {
      fromSmLogical = false;
    }
    if (!fromSmLogical) {
      return {
        valid: false,
        code: "LOGICAL_INVALID_TYPE",
        error: errorMessages.invalidType ||
          "Trường \"" + fieldName + "\" không đúng kiểu Logical."
      };
    }
  }

  var empty = rawValue === undefined || rawValue === null;
  if (typeof rawValue === "string") {
    if (trim) rawValue = rawValue.replace(/^\s+|\s+$/g, "");
    empty = rawValue === "";
  }
  if (empty) {
    if (required) {
      return {
        valid: false,
        code: "LOGICAL_REQUIRED",
        error: errorMessages.required || "\"" + fieldName + "\" chưa được lựa chọn."
      };
    }
    return { valid: true, value: null };
  }

  if (typeof rawValue === "boolean") return { valid: true, value: rawValue };
  if (typeof rawValue === "number") {
    if (!allowNumber || (rawValue !== 0 && rawValue !== 1)) {
      return {
        valid: false,
        code: allowNumber ? "LOGICAL_INVALID_VALUE" : "LOGICAL_INVALID_TYPE",
        error: errorMessages.invalidValue ||
          "Giá trị của \"" + fieldName + "\" phải là true hoặc false."
      };
    }
    return { valid: true, value: rawValue === 1 };
  }
  if (typeof rawValue === "string") {
    if (!allowString && !fromSmLogical) {
      return {
        valid: false,
        code: "LOGICAL_INVALID_TYPE",
        error: errorMessages.invalidType ||
          "Trường \"" + fieldName + "\" không đúng kiểu Logical."
      };
    }
    var normalizedValue = normalizeToken(rawValue);
    if (normalizedTrueValues.indexOf(normalizedValue) >= 0) {
      return { valid: true, value: true };
    }
    if (normalizedFalseValues.indexOf(normalizedValue) >= 0) {
      return { valid: true, value: false };
    }
    return {
      valid: false,
      code: "LOGICAL_INVALID_VALUE",
      error: errorMessages.invalidValue ||
        "Giá trị của \"" + fieldName + "\" phải là true hoặc false."
    };
  }

  return {
    valid: false,
    code: "LOGICAL_INVALID_TYPE",
    error: errorMessages.invalidType ||
      "Trường \"" + fieldName + "\" không đúng kiểu Logical."
  };
}

function _readArrayValue(input) {
  if (input === undefined || input === null) {
    return { valid: true, empty: true, value: [] };
  }
  if (Array.isArray(input)) {
    return { valid: true, empty: input.length === 0, value: input.slice(0) };
  }
  if (typeof input !== "object") return { valid: false, reason: "type" };

  var adapter = _validationSmAdapter();
  if (adapter && typeof adapter.readArray === "function") {
    var adapted = adapter.readArray(input);
    if (adapted && adapted.valid === true) return adapted;
    if (adapted && adapted.reason) return adapted;
  }

  try {
    var smType = typeof input.getType === "function" ? input.getType() : null;
    var isSmArray = Number(smType) === 8 || String(smType).toUpperCase() === "ARRAY";
    if (!isSmArray) return { valid: false, reason: "type" };

    var source = input;
    if (typeof input.toArray === "function") source = input.toArray();
    if (Array.isArray(source)) {
      return { valid: true, empty: source.length === 0, value: source.slice(0) };
    }

    var length = null;
    if (source && typeof source.length === "function") {
      length = Number(source.length());
    } else if (source && typeof source.length === "number") {
      length = Number(source.length);
    } else if (typeof funcs !== "undefined" && funcs && typeof funcs.lng === "function") {
      length = Number(funcs.lng(input));
    }
    if (length === null || !isFinite(length) || length < 0 || Math.floor(length) !== length) {
      return { valid: false, reason: "type" };
    }
    var values = [];
    for (var i = 0; i < length; i++) values.push(source[i]);
    return { valid: true, empty: values.length === 0, value: values };
  } catch (ignoredArrayTypeError) {
    return { valid: false, reason: "type" };
  }
}

function _createArrayValue(values) {
  var adapter = _validationSmAdapter();
  if (adapter && typeof adapter.createArray === "function") {
    return adapter.createArray(values);
  }
  if (typeof SCDatum === "undefined") return values;
  var datum = new SCDatum();
  datum.setType(8);
  for (var i = 0; i < values.length; i++) datum.push(values[i]);
  return datum;
}

function _isEmptyArrayItem(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.replace(/^\s+|\s+$/g, "") === "";
  if (typeof value === "object") {
    try {
      var smType = typeof value.getType === "function" ? value.getType() : null;
      if ((Number(smType) === 2 || String(smType).toUpperCase() === "CHARACTER") &&
          typeof value.getText === "function") {
        return String(value.getText()).replace(/^\s+|\s+$/g, "") === "";
      }
    } catch (ignoredEmptyItemError) {}
  }
  return false;
}

function _arrayItemKey(value, caseSensitive) {
  if (value === null || value === undefined) return "null:";
  if (typeof value === "string") {
    return "string:" + (caseSensitive ? value : value.toLowerCase());
  }
  if (typeof value === "number") return "number:" + String(value === 0 ? 0 : value);
  if (typeof value === "boolean") return "logical:" + String(value);
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return "datetime:" + String(value.getTime());
  }
  if (typeof value === "object") {
    try {
      var smType = typeof value.getType === "function" ? value.getType() : null;
      if ((Number(smType) === 3 || String(smType).toUpperCase() === "DATETIME" ||
          String(smType).toUpperCase() === "DATE/TIME") && typeof value.getTime === "function") {
        return "datetime:" + String(value.getTime());
      }
    } catch (ignoredArrayKeyError) {}
  }
  return typeof value + ":" + String(value);
}

/* Validate DBDict Array (SM type 8), không hỗ trợ Structure.
 * elementType: character | number | datetime | logical; hoặc truyền itemValidator.
 */
function validateArray(input, options) {
  options = options === undefined ? {} : options;
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return {
      valid: false,
      code: "VALIDATOR_CONFIG_INVALID",
      error: "Cấu hình kiểm tra dữ liệu Array không hợp lệ."
    };
  }

  var invalidFieldName = options.fieldName !== undefined && options.fieldName !== null &&
    typeof options.fieldName !== "string";
  var fieldName = options.fieldName === undefined || options.fieldName === null ||
    String(options.fieldName).replace(/^\s+|\s+$/g, "") === ""
    ? "dữ liệu" : String(options.fieldName);
  var knownOptionsResult = _validationCheckKnownOptions(
    options,
    ["fieldName", "required", "minItems", "maxItems", "maxInputItems",
      "emptyItemPolicy", "unique", "caseSensitive", "elementType",
      "elementOptions", "itemValidator", "uniqueKey", "errorMessages"],
    ["invalidType", "required", "minItems", "maxItems", "inputLimit",
      "emptyItem", "itemInvalid", "itemValidatorError", "duplicate"],
    fieldName
  );
  if (knownOptionsResult) return knownOptionsResult;
  var required = options.required === undefined ? true : options.required;
  var minItems = options.minItems === undefined ? 0 : options.minItems;
  var maxItems = options.maxItems === undefined ? 10000 : options.maxItems;
  var maxInputItems = options.maxInputItems === undefined
    ? 10000 : options.maxInputItems;
  var emptyItemPolicy = options.emptyItemPolicy === undefined
    ? "reject" : options.emptyItemPolicy;
  var unique = options.unique === undefined ? false : options.unique;
  var caseSensitive = options.caseSensitive === undefined ? true : options.caseSensitive;
  var elementType = options.elementType === undefined ? null : options.elementType;
  var elementOptions = options.elementOptions === undefined ? {} : options.elementOptions;
  var itemValidator = options.itemValidator === undefined ? null : options.itemValidator;
  var uniqueKey = options.uniqueKey === undefined ? null : options.uniqueKey;
  var errorMessages = options.errorMessages === undefined ? {} : options.errorMessages;

  var invalidBooleanOption = typeof required !== "boolean" || typeof unique !== "boolean" ||
    typeof caseSensitive !== "boolean";
  var invalidLimits = typeof minItems !== "number" || !isFinite(minItems) ||
    minItems < 0 || Math.floor(minItems) !== minItems ||
    typeof maxItems !== "number" || !isFinite(maxItems) ||
    maxItems < 0 || Math.floor(maxItems) !== maxItems ||
    typeof maxInputItems !== "number" || !isFinite(maxInputItems) ||
    maxInputItems <= 0 || Math.floor(maxInputItems) !== maxInputItems ||
    minItems > maxItems || maxItems > maxInputItems ||
    (required && maxItems === 0);
  var invalidEmptyPolicy = emptyItemPolicy !== "reject" && emptyItemPolicy !== "remove" &&
    emptyItemPolicy !== "keep";
  var supportedTypes = {
    character: validateCharacter,
    number: validateNumber,
    datetime: validateDateTime,
    logical: validateLogical
  };
  var invalidElementType = elementType !== null &&
    (typeof elementType !== "string" || !supportedTypes[elementType]);
  var invalidElementOptions = !elementOptions || typeof elementOptions !== "object" ||
    Array.isArray(elementOptions);
  var invalidItemValidator = itemValidator !== null && typeof itemValidator !== "function";
  var invalidUniqueKey = uniqueKey !== null && typeof uniqueKey !== "function";
  var missingValidator = elementType === null && itemValidator === null;
  var invalidMessages = !errorMessages || typeof errorMessages !== "object" ||
    Array.isArray(errorMessages);
  if (!invalidMessages) {
    for (var messageKey in errorMessages) {
      if (Object.prototype.hasOwnProperty.call(errorMessages, messageKey) &&
          typeof errorMessages[messageKey] !== "string") {
        invalidMessages = true;
        break;
      }
    }
  }

  if (invalidFieldName || invalidBooleanOption || invalidLimits || invalidEmptyPolicy ||
      invalidElementType || invalidElementOptions || invalidItemValidator || invalidUniqueKey ||
      missingValidator || invalidMessages) {
    return {
      valid: false,
      code: "VALIDATOR_CONFIG_INVALID",
      error: "Cấu hình kiểm tra trường \"" + fieldName + "\" không hợp lệ."
    };
  }

  // Validate cấu hình phần tử ngay cả khi array đầu vào rỗng.
  if (elementType !== null) {
    var probeOptions = {};
    for (var probeKey in elementOptions) {
      if (_validationHasOwn(elementOptions, probeKey)) {
        probeOptions[probeKey] = elementOptions[probeKey];
      }
    }
    if (!_validationHasOwn(probeOptions, "required")) probeOptions.required = false;
    var probeResult = supportedTypes[elementType](undefined, probeOptions);
    if (probeResult && (probeResult.code === "VALIDATOR_CONFIG_INVALID" ||
        probeResult.code === "VALIDATOR_CONFIG_UNKNOWN_OPTION")) {
      return {
        valid: false,
        code: probeResult.code,
        error: "Cấu hình phần tử của \"" + fieldName + "\" không hợp lệ: " +
          probeResult.error,
        details: probeResult.details || {}
      };
    }
  }

  var arrayResult = _readArrayValue(input);
  if (!arrayResult.valid) {
    return {
      valid: false,
      code: "ARRAY_INVALID_TYPE",
      error: errorMessages.invalidType ||
        "Trường \"" + fieldName + "\" không đúng kiểu Array."
    };
  }
  if (arrayResult.value.length > maxInputItems) {
    return {
      valid: false,
      code: "ARRAY_INPUT_LIMIT_EXCEEDED",
      error: errorMessages.inputLimit ||
        "Dữ liệu nhập của \"" + fieldName + "\" vượt giới hạn an toàn " +
          maxInputItems + " phần tử."
    };
  }

  var normalizedItems = [];
  var itemKeys = {};
  var baseValidator = elementType === null ? null : supportedTypes[elementType];
  for (var i = 0; i < arrayResult.value.length; i++) {
    var sourceItem = arrayResult.value[i];
    var emptyItem = _isEmptyArrayItem(sourceItem);
    if (emptyItem && emptyItemPolicy === "remove") continue;
    if (emptyItem && emptyItemPolicy === "reject") {
      return {
        valid: false,
        code: "ARRAY_EMPTY_ITEM",
        index: i,
        error: errorMessages.emptyItem ||
          "Phần tử thứ " + (i + 1) + " của \"" + fieldName + "\" đang để trống."
      };
    }

    var itemValue = sourceItem;
    if (baseValidator !== null) {
      var currentOptions = {};
      for (var optionKey in elementOptions) {
        if (Object.prototype.hasOwnProperty.call(elementOptions, optionKey)) {
          currentOptions[optionKey] = elementOptions[optionKey];
        }
      }
      if (emptyItem && emptyItemPolicy === "keep") currentOptions.required = false;
      var itemResult = baseValidator(itemValue, currentOptions);
      if (!itemResult || itemResult.valid !== true) {
        return {
          valid: false,
          code: "ARRAY_ITEM_INVALID",
          index: i,
          itemCode: itemResult && itemResult.code ? itemResult.code : "",
          itemError: itemResult && itemResult.error ? itemResult.error : "",
          error: errorMessages.itemInvalid ||
            "Phần tử thứ " + (i + 1) + " của \"" + fieldName + "\" không hợp lệ" +
              (itemResult && itemResult.error ? ": " + itemResult.error : ".")
        };
      }
      if (itemResult.value !== undefined) itemValue = itemResult.value;
    }

    if (itemValidator !== null) {
      var customResult;
      try {
        customResult = itemValidator(itemValue, i, arrayResult.value);
      } catch (ignoredItemValidatorError) {
        return {
          valid: false,
          code: "ARRAY_ITEM_VALIDATOR_ERROR",
          index: i,
          error: errorMessages.itemValidatorError ||
            "Không thể kiểm tra phần tử thứ " + (i + 1) + " của \"" + fieldName + "\"."
        };
      }
      if (!customResult || customResult.valid !== true) {
        return {
          valid: false,
          code: "ARRAY_ITEM_INVALID",
          index: i,
          itemCode: customResult && customResult.code ? customResult.code : "",
          itemError: customResult && customResult.error ? customResult.error : "",
          error: errorMessages.itemInvalid ||
            "Phần tử thứ " + (i + 1) + " của \"" + fieldName + "\" không hợp lệ" +
              (customResult && customResult.error ? ": " + customResult.error : ".")
        };
      }
      if (customResult.value !== undefined) itemValue = customResult.value;
    }

    if (unique) {
      var itemKey;
      try {
        itemKey = uniqueKey === null
          ? _arrayItemKey(itemValue, caseSensitive)
          : "custom:" + String(uniqueKey(itemValue, i));
      } catch (ignoredUniqueKeyError) {
        return {
          valid: false,
          code: "ARRAY_ITEM_VALIDATOR_ERROR",
          index: i,
          error: errorMessages.itemValidatorError ||
            "Không thể tạo khóa kiểm tra trùng cho \"" + fieldName + "\"."
        };
      }
      if (Object.prototype.hasOwnProperty.call(itemKeys, itemKey)) {
        return {
          valid: false,
          code: "ARRAY_DUPLICATE_ITEM",
          index: i,
          duplicateOf: itemKeys[itemKey],
          error: errorMessages.duplicate ||
            "Phần tử thứ " + (i + 1) + " của \"" + fieldName + "\" bị trùng."
        };
      }
      itemKeys[itemKey] = i;
    }
    normalizedItems.push(itemValue);
  }

  if (required && normalizedItems.length === 0) {
    return {
      valid: false,
      code: "ARRAY_REQUIRED",
      error: errorMessages.required || "\"" + fieldName + "\" không được để trống."
    };
  }
  if (normalizedItems.length < minItems) {
    return {
      valid: false,
      code: "ARRAY_MIN_ITEMS",
      error: errorMessages.minItems ||
        "Trường \"" + fieldName + "\" phải có ít nhất " + minItems + " phần tử."
    };
  }
  if (normalizedItems.length > maxItems) {
    return {
      valid: false,
      code: "ARRAY_MAX_ITEMS",
      error: errorMessages.maxItems ||
        "Trường \"" + fieldName + "\" chỉ được có tối đa " + maxItems + " phần tử."
    };
  }

  return { valid: true, value: _createArrayValue(normalizedItems) };
}

function validatorsList() {
  var validators = {
    character: validateCharacter,
    datetime: validateDateTime,
    logical: validateLogical,
    number: validateNumber,
    array: validateArray
  };
  return validators;
}

// Profile nghiệp vụ xây trên kiểu DBDict, tách khỏi registry kiểu dữ liệu nền.
function validationProfiles() {
  return {
    decimalCharacter: validateDecimalCharacter
  };
}

function getValidator(name) {
  var validators = validatorsList();
  if (_validationHasOwn(validators, name)) return validators[name];
  var profiles = validationProfiles();
  return _validationHasOwn(profiles, name) ? profiles[name] : null;
}
