/**
 * MẪU ÁP DỤNG VALIDATION CORE CHO FORM CÓ NHIỀU KIỂU INPUT
 *
 * Đây là template của ScriptLibrary nghiệp vụ, không phải core runtime.
 * Caller tự xác định và truyền đúng SCFile/record vào validateExampleForm(file).
 * Thay toàn bộ tên field ví dụ bằng field DBDict của form thực tế.
 */

/* Rule liên trường chạy sau khi từng field đã hợp lệ.
 * draft chứa các giá trị đã được chuẩn hóa nhưng chưa ghi vào record. */
function validateExampleDateRange(draft) {
  var startDate = draft["start.date"];
  var endDate = draft["end.date"];

  // Hai field đã được required ở schema; kiểm tra null để rule vẫn an toàn khi tái sử dụng.
  if (startDate === undefined || startDate === null ||
      endDate === undefined || endDate === null) {
    return { valid: true };
  }

  try {
    if (Number(startDate.getTime()) <= Number(endDate.getTime())) {
      return { valid: true };
    }
  } catch (ignoredDateRangeError) {}

  return {
    valid: false,
    field: "end.date",
    code: "DATE_RANGE_INVALID",
    error: "Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu."
  };
}

/* Rule nghiệp vụ riêng có thể query DB/repository tại đây.
 * Không đưa truy vấn DB vào primitive validator. */
function validateExampleBusinessRule(draft, context) {
  // Ví dụ:
  // var duplicate = new SCFile(context.table);
  // var rc = duplicate.doSelect('id="' + draft.id + '"');
  // if (rc === RC_SUCCESS) {
  //   return {
  //     valid: false,
  //     field: "id",
  //     code: "DUPLICATE_ID",
  //     error: "Mã đã tồn tại trong hệ thống."
  //   };
  // }
  return { valid: true };
}

function validateExampleForm(file) {
  var fields = [
    // 1. Text input -> DBDict Character.
    {
      field: "name",
      type: "character",
      options: {
        fieldName: "Tên hồ sơ",
        required: true,
        trim: true,
        collapseWhitespace: true,
        singleLine: true,
        minLength: 3,
        maxLength: 200
      }
    },

    // 2. Text mã: Character có pattern và danh sách giá trị cho phép.
    {
      field: "category",
      type: "character",
      options: {
        fieldName: "Loại hồ sơ",
        required: true,
        trim: true,
        singleLine: true,
        maxLength: 30,
        pattern: /^[A-Z0-9._-]+$/,
        allowedValues: ["CONTRACT", "SERVICE", "OTHER"],
        caseSensitive: true
      }
    },

    // 3. Number input -> DBDict Number; ví dụ số lượng nguyên.
    {
      field: "quantity",
      type: "number",
      options: {
        fieldName: "Số lượng",
        required: true,
        integerOnly: true,
        safeIntegerOnly: true,
        min: 1,
        max: 10000
      }
    },

    // 4. Number có phần thập phân nhưng chấp nhận đặc tính floating point.
    {
      field: "completion.rate",
      type: "number",
      options: {
        fieldName: "Tỷ lệ hoàn thành",
        required: false,
        min: 0,
        max: 100,
        maxDecimalPlaces: 2,
        precisionPolicy: "reject"
      }
    },

    // 5. Tiền/decimal chính xác lưu trong DBDict Character.
    {
      field: "contract.value.total",
      type: "decimalCharacter",
      options: {
        fieldName: "Tổng giá trị hợp đồng",
        required: true,
        precision: 18,
        scale: 2,
        maxInputLength: 40,
        maxLength: 19,
        decimalSeparator: ",",
        groupSeparator: ".",
        min: "0.00"
      }
    },

    // 6. Input Date-only -> DBDict Date/Time, chuẩn hóa giờ về 00:00:00.
    {
      field: "document.date",
      type: "datetime",
      options: {
        fieldName: "Ngày văn bản",
        required: false,
        mode: "date"
      }
    },

    // 7. Input DateTime hiển thị tới phút.
    {
      field: "start.date",
      type: "datetime",
      options: {
        fieldName: "Ngày bắt đầu",
        required: true,
        mode: "datetime-minute"
      }
    },
    {
      field: "end.date",
      type: "datetime",
      options: {
        fieldName: "Ngày kết thúc",
        required: true,
        mode: "datetime-minute"
      }
    },

    // 8. Checkbox/radio -> DBDict Logical. false vẫn là giá trị hợp lệ.
    {
      field: "is.budgeted",
      type: "logical",
      options: {
        fieldName: "Có dự chi",
        required: true,
        trueValues: ["true", "yes", "1", "co"],
        falseValues: ["false", "no", "0", "khong"]
      }
    },

    // 9. Array<Character>: multiselect/danh sách mã người dùng.
    {
      field: "reviewers",
      type: "array",
      options: {
        fieldName: "Danh sách người duyệt",
        required: true,
        minItems: 1,
        maxItems: 20,
        maxInputItems: 100,
        emptyItemPolicy: "remove",
        unique: true,
        caseSensitive: false,
        elementType: "character",
        elementOptions: {
          fieldName: "Người duyệt",
          required: true,
          trim: true,
          maxLength: 80
        }
      }
    },

    // 10. Array<Number>: mỗi phần tử tiếp tục dùng validateNumber.
    {
      field: "payment.percentages",
      type: "array",
      options: {
        fieldName: "Tỷ lệ các đợt thanh toán",
        required: false,
        maxItems: 20,
        maxInputItems: 100,
        emptyItemPolicy: "remove",
        elementType: "number",
        elementOptions: {
          fieldName: "Tỷ lệ thanh toán",
          required: true,
          min: 0,
          max: 100,
          maxDecimalPlaces: 2
        }
      }
    },

    // 11. Field có điều kiện: chỉ validate khi category = OTHER.
    {
      field: "other.reason",
      type: "character",
      when: function (draft) {
        return draft.category === "OTHER";
      },
      options: {
        fieldName: "Lý do chọn loại khác",
        required: true,
        trim: true,
        minLength: 5,
        maxLength: 1000
      }
    }
  ];

  return lib.ESD_Validation_Ruleset_Adapter.validateRecord(file, fields, {
    // failFast: phù hợp Ruleset popup lỗi và trỏ cursor vào field đầu tiên.
    // collectAll: dùng khi UI có khả năng hiển thị nhiều lỗi đồng thời.
    mode: "failFast",
    // Chỉ ghi giá trị chuẩn hóa sau khi mọi field và recordRules hợp lệ.
    commit: true,
    // Logic liên trường và nghiệp vụ đặc thù của form.
    recordRules: [
      validateExampleDateRange,
      validateExampleBusinessRule
    ],
    // Dữ liệu phụ cho business rule; không đặt biến global vào core.
    context: {
      table: "your.table.name"
    }
  });
}

/* CÁCH GỌI BÊN TRONG MỘT HÀM NGHIỆP VỤ CÙNG SCRIPTLIBRARY
 *
 * Hàm validateExampleForm() được gọi trực tiếp vì nằm cùng ScriptLibrary.
 * Chỉ chạy xử lý tiếp theo khi validation thành công. */
function executeExampleAction(file) {
  var validationResult = validateExampleForm(file);

  if (validationResult.hasError) {
    return validationResult;
  }

  // Đặt xử lý nghiệp vụ sau validation tại đây.
  // Ví dụ: gọi Ruleset khác, cập nhật bảng liên quan hoặc lưu record.

  return {
    returnCode: 0,
    message: "Dữ liệu hợp lệ và xử lý nghiệp vụ thành công.",
    cursorPosition: "",
    hasError: false,
    errors: [],
    values: validationResult.values,
    committed: validationResult.committed
  };
}

/* CÁCH GỌI TỪ MỘT SCRIPTLIBRARY KHÁC
 *
 * function executeFromAnotherLibrary(file) {
 *   var result = lib.<ScriptLibrary-nghiep-vu>.validateExampleForm(file);
 *   if (result.hasError) return result;
 *
 *   // Tiếp tục logic của ScriptLibrary đang gọi.
 *   return {
 *     returnCode: 0,
 *     message: "Xử lý thành công.",
 *     cursorPosition: "",
 *     hasError: false
 *   };
 * }
 */

/* CÁCH GỌI TRONG RULESET
 *
 * Caller tự chọn vars/record/currentFile đúng với ngữ cảnh đang chạy:
 *
 * var result = lib.<ScriptLibrary-nghiep-vu>.validateExampleForm(currentFile);
 * returnCode = result.returnCode;
 * message = result.message;
 * cursorPosition = result.cursorPosition;
 *
 * result.hasError  : true nếu có lỗi.
 * result.errors    : toàn bộ lỗi khi mode = "collectAll".
 * result.values    : dữ liệu đã chuẩn hóa.
 * result.committed : true nếu commit vào record thành công.
 */
