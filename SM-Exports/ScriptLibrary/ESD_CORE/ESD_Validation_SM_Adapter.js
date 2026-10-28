/**
 * ScriptLibrary name: ESD_Validation_SM_Adapter
 * Cô lập chuyển đổi giá trị đặc thù của Service Manager khỏi validator thuần.
 * Không chứa luật bắt buộc, min/max hoặc logic nghiệp vụ.
 */

function _validationAdapterIsJsDate(value) {
  return Object.prototype.toString.call(value) === "[object Date]";
}

function readDateTime(input) {
  if (input === undefined || input === null) {
    return { valid: true, empty: true, value: null };
  }
  if (_validationAdapterIsJsDate(input)) {
    var jsTime = Number(input.getTime());
    return isFinite(jsTime)
      ? { valid: true, empty: false, value: new Date(jsTime) }
      : { valid: false, reason: "value" };
  }
  if (typeof input !== "object") return { valid: false, reason: "type" };

  try {
    var smType = typeof input.getType === "function" ? input.getType() : null;
    var typeName = String(smType).toUpperCase();
    var isDateTime = Number(smType) === 3 || typeName === "DATETIME" ||
      typeName === "DATE/TIME";
    if (!isDateTime || typeof input.getTime !== "function") {
      return { valid: false, reason: "type" };
    }
    var rawTime = input.getTime();
    var time = _validationAdapterIsJsDate(rawTime)
      ? Number(rawTime.getTime()) : Number(rawTime);
    return isFinite(time)
      ? { valid: true, empty: false, value: new Date(time) }
      : { valid: false, reason: "value" };
  } catch (ignoredDateTimeReadError) {
    return { valid: false, reason: "type" };
  }
}

function createDateTime(value) {
  if (!_validationAdapterIsJsDate(value) || !isFinite(Number(value.getTime()))) {
    throw new Error("Date/Time output is invalid");
  }
  if (typeof SCDatum === "undefined" || typeof funcs === "undefined" ||
      !funcs || typeof funcs.datemake !== "function") {
    return new Date(value.getTime());
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

function readArray(input) {
  if (input === undefined || input === null) {
    return { valid: true, empty: true, value: [] };
  }
  if (Array.isArray(input)) {
    return { valid: true, empty: input.length === 0, value: input.slice(0) };
  }
  if (typeof input !== "object") return { valid: false, reason: "type" };

  try {
    var smType = typeof input.getType === "function" ? input.getType() : null;
    if (Number(smType) !== 8 && String(smType).toUpperCase() !== "ARRAY") {
      return { valid: false, reason: "type" };
    }
    if (typeof input.toArray === "function") {
      var converted = input.toArray();
      if (Array.isArray(converted)) {
        return { valid: true, empty: converted.length === 0, value: converted.slice(0) };
      }
    }

    var length = null;
    if (typeof input.length === "function") length = Number(input.length());
    else if (typeof input.length === "number") length = Number(input.length);
    else if (typeof funcs !== "undefined" && funcs && typeof funcs.lng === "function") {
      length = Number(funcs.lng(input));
    }
    if (length === null || !isFinite(length) || length < 0 ||
        Math.floor(length) !== length) {
      return { valid: false, reason: "type" };
    }
    var values = [];
    for (var i = 0; i < length; i++) values.push(input[i]);
    return { valid: true, empty: values.length === 0, value: values };
  } catch (ignoredArrayReadError) {
    return { valid: false, reason: "type" };
  }
}

function createArray(values) {
  if (!Array.isArray(values)) throw new Error("Array output is invalid");
  if (typeof SCDatum === "undefined") return values.slice(0);
  var datum = new SCDatum();
  datum.setType(8);
  for (var i = 0; i < values.length; i++) datum.push(values[i]);
  return datum;
}
