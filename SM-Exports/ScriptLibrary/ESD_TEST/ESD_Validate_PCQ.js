/**
 * ScriptLibrary name: ESD_Validate_PCQ
 *
 * Ví dụ áp dụng Validation Core cho form esdQTPermissionReq.
 * Caller phải truyền đúng SCFile/record của form vào validatePCQ(file).
 */

/* Escape giá trị trước khi ghép vào query SM.
 * Ưu tiên utility chuẩn của hệ thống; fallback giúp sample hoạt động độc lập. */
function _pcqEscapeQueryValue(value) {
  var text = value === undefined || value === null ? "" : String(value);
  if (typeof lib !== "undefined" && lib && lib.StringUtil &&
      typeof lib.StringUtil.escapeAllStr === "function") {
    return lib.StringUtil.escapeAllStr(text);
  }
  return text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

/* Tạo biên ngày tại thời điểm validate, không cố định ngày trong source.
 * today       : 00:00:00 của ngày hiện tại.
 * beforeDay10 : 00:00:00 của ngày hiện tại + 10 ngày (không bao gồm). */
function _pcqCreatedAtRange() {
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var beforeDay10 = new Date(today.getTime());
  beforeDay10.setDate(beforeDay10.getDate() + 10);

  return {
    min: today,
    max: beforeDay10
  };
}

/* Business rule: tên phiếu không được trùng bản ghi khác.
 * Khi cập nhật, điều kiện id~=... loại chính ticket đang sửa khỏi kết quả. */
function validatePCQNameUnique(draft, context) {
  var name = draft.name;
  if (name === undefined || name === null || String(name) === "") {
    return { valid: true };
  }

  try {
    var duplicate = new SCFile(context.table);
    var query = 'name="' + _pcqEscapeQueryValue(name) + '"';
    // Lấy từ context để vẫn hoạt động khi field id không nằm trong schema validate.
    var currentId = context.currentId;

    if (currentId !== undefined && currentId !== null && String(currentId) !== "") {
      query += ' and id~="' + _pcqEscapeQueryValue(currentId) + '"';
    }

    if (duplicate.doSelect(query) === RC_SUCCESS) {
      return {
        valid: false,
        field: "name",
        code: "PCQ_NAME_DUPLICATE",
        error: "Tên phiếu đã tồn tại trên một ticket khác."
      };
    }
  } catch (duplicateCheckError) {
    // Không bỏ qua lỗi DB vì có thể làm lọt dữ liệu trùng.
    return {
      valid: false,
      field: "name",
      code: "PCQ_NAME_DUPLICATE_CHECK_FAILED",
      error: "Không thể kiểm tra trùng tên phiếu. Vui lòng thử lại."
    };
  }

  return { valid: true };
}

function validatePCQ(file) {
  var createdAtRange = _pcqCreatedAtRange();
  var fields = [
    {
      field: "id",
      type: "character",
      options: {
        fieldName: "Mã phiếu",
        required: true,
        trim: true,
        singleLine: true,
        minLength: 5,
        maxLength: 20
      }
    },
    {
      field: "name",
      type: "character",
      options: {
        fieldName: "Tên phiếu",
        required: true,
        trim: true,
        collapseWhitespace: true,
        singleLine: true,
        maxLength: 200
      }
    },
    {
      field: "created.at",
      type: "datetime",
      options: {
        fieldName: "Ngày tạo",
        required: true,
        mode: "date",
        min: createdAtRange.min,
        minInclusive: true,
        max: createdAtRange.max,
        maxInclusive: false,
        errorMessages: {
          min: "Ngày tạo phải lớn hơn hoặc bằng ngày hiện tại.",
          max: "Ngày tạo phải nhỏ hơn ngày hiện tại cộng 10 ngày."
        }
      }
    },
    {
      field: "quantity",
      type: "number",
      options: {
        fieldName: "Quantity",
        required: true,
        integerOnly: true,
        safeIntegerOnly: true,
        min: 0,
        max: 10000,
        errorMessages: {
          max: "Quantity không được vượt quá 10000."
        }
      }
    },
    {
      // DBDict Character lưu tiền chính xác; field hiện không bắt buộc.
      field: "summary.value",
      type: "decimalCharacter",
      options: {
        fieldName: "Summary value",
        required: false,
        precision: 18,
        scale: 2,
        maxInputLength: 40,
        maxLength: 19,
        decimalSeparator: ",",
        groupSeparator: ".",
        allowNegative: false,
        min: "0.00"
      }
    }
  ];

  return lib.ESD_Validation_Ruleset_Adapter.validateRecord(file, fields, {
    // Ruleset hiển thị lỗi đầu tiên và đặt cursor đúng input tương ứng.
    mode: "failFast",
    // Chỉ ghi dữ liệu chuẩn hóa vào file sau khi toàn bộ validation thành công.
    commit: true,
    recordRules: [
      validatePCQNameUnique
    ],
    context: {
      table: "esdQTPermissionReq",
      currentId: file && file.id !== undefined ? file.id : null
    }
  });
}

/* CÁCH GỌI TRONG RULESET
 *
 * // Trong Execute JavaScript của RuleSet, record hiện tại thường là $L.file.
 * var currentFile = vars["$L.file"];
 * var result = lib.ESD_Validate_PCQ.validatePCQ(currentFile);
 * returnCode = result.returnCode;
 * message = result.message;
 * cursorPosition = result.cursorPosition;
 *
 * Không đặt đoạn gọi này ở cuối ScriptLibrary và không dùng biến `record`
 * nếu RuleSet chưa tự khai báo biến đó.
 */

/* CÁCH GỌI TRONG HÀM KHÁC
 *
 * function executePCQ(file) {
 *   var result = validatePCQ(file); // Cùng ScriptLibrary.
 *   // Khác ScriptLibrary: lib.ESD_Validate_PCQ.validatePCQ(file);
 *   if (result.hasError) return result;
 *
 *   // Chỉ xử lý/lưu dữ liệu khi validation đã thành công.
 *   return {
 *     returnCode: 0,
 *     message: "Dữ liệu hợp lệ.",
 *     cursorPosition: "",
 *     hasError: false
 *   };
 * }
 */
