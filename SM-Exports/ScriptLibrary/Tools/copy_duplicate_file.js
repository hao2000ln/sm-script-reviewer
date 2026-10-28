/**
 * Copy các field từ record nguồn sang record đích.
 *
 * @param {SCFile} source Record nguồn.
 * @param {SCFile} target Record đích.
 * @param {Array} sourceFields Các field cần copy từ nguồn.
 * @param {Array} targetFields Các field tương ứng tại đích.
 *                             Bỏ trống nếu field đích cùng tên.
 * @returns {SCFile} Record đích sau khi copy.
 */
function copyRecordFields(source, target, sourceFields, targetFields) {
  if (!source) {
    throw new Error("[copyRecordFields] source is required");
  }

  if (!target) {
    throw new Error("[copyRecordFields] target is required");
  }

  if (!Array.isArray(sourceFields) || sourceFields.length === 0) {
    throw new Error("[copyRecordFields] sourceFields must be a non-empty array");
  }

  var destinationFields = targetFields || sourceFields;
  if (!Array.isArray(destinationFields)) {
    throw new Error("[copyRecordFields] targetFields must be an array");
  }

  if (sourceFields.length !== destinationFields.length) {
    throw new Error("[copyRecordFields] sourceFields and targetFields must have the same length");
  }

  system.functions.recordcopy(source, sourceFields, target, destinationFields);

  return target;
}

/**
 * Copy rồi lưu một record. action bắt buộc là "insert" hoặc "update".
 * sourceQuery và targetQuery phải xác định record bằng khóa duy nhất.
 * targetQuery bắt buộc khi update; không tìm thấy đích thì không ghi dữ liệu.
 * targetValues được gán sau copy. Caller chịu trách nhiệm quyền truy cập,
 * query hợp lệ và các quy tắc nghiệp vụ của bảng dùng doInsert/doUpdate.
 */
function copyRecord(options) {
  var source = null;
  var target = null;

  try {
    if (!options) {
      throw new Error("[copyRecord] options is required");
    }

    var sourceTable = options.sourceTable;
    var targetTable = options.targetTable || sourceTable;
    var sourceQuery = options.sourceQuery;
    var sourceFields = options.sourceFields;
    var targetFields = options.targetFields || sourceFields;
    var targetValues = options.targetValues || {};
    var action = options.action;

    if (action !== "insert" && action !== "update") {
      throw new Error("[copyRecord] action must be insert or update");
    }

    if (action === "update" && !options.targetQuery) {
      throw new Error("[copyRecord] targetQuery is required for update");
    }

    if (!Array.isArray(sourceFields) || sourceFields.length === 0) {
      throw new Error("[copyRecord] sourceFields must be a non-empty array");
    }

    if (!Array.isArray(targetFields) || sourceFields.length !== targetFields.length) {
      throw new Error("[copyRecord] field arrays must have the same length");
    }

    if (!sourceTable || !targetTable) {
      throw new Error("[copyRecord] table name is required");
    }

    if (!sourceQuery) {
      throw new Error("[copyRecord] sourceQuery is required");
    }

    source = new SCFile(sourceTable, SCFILE_READONLY);
    source.setFields(sourceFields);

    var rc = source.doSelect(sourceQuery);
    if (rc !== RC_SUCCESS) {
      return {
        success: false,
        message: "Source record not found",
        returnCode: rc
      };
    }

    target = new SCFile(targetTable);
    if (action === "update") {
      rc = target.doSelect(options.targetQuery);
      if (rc !== RC_SUCCESS) {
        return { success: false, message: "Target select failed or record not found", returnCode: rc };
      }
    }

    copyRecordFields(source, target, sourceFields, targetFields);

    for (var fieldName in targetValues) {
      if (Object.prototype.hasOwnProperty.call(targetValues, fieldName)) {
        target[fieldName] = targetValues[fieldName];
      }
    }

    rc = action === "insert" ? target.doInsert() : target.doUpdate();
    if (rc !== RC_SUCCESS) {
      return {
        success: false,
        message: action + " failed",
        returnCode: rc
      };
    }

    return {
      success: true,
      message: "Record copied successfully",
      returnCode: rc
    };
  } catch (e) {
    print("[copyRecord] " + e.message);

    return {
      success: false,
      message: e.message
    };
  } finally {
    try {
      if (source) {
        source.doClose();
      }
    } finally {
      if (target) {
        target.doClose();
      }
    }
  }
}

// Tương thích caller cũ: hàm này chỉ cho phép insert.
function copyAndInsertRecord(options) {
  var config = {};
  for (var key in options) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      config[key] = options[key];
    }
  }

  if (config.action && config.action !== "insert") {
    return { success: false, message: "Use copyRecord for update" };
  }

  config.action = "insert";
  return copyRecord(config);
}

/**
 * Duplicate toàn bộ record buffer từ source sang target.
 * Thứ tự của fduplicate là target trước, source sau.
 * Hàm chỉ duplicate trong bộ nhớ và không tự lưu database.
 */
function duplicateFile(source, target) {
  if (!source) {
    throw new Error("[duplicateFile] source is required");
  }

  if (!target) {
    throw new Error("[duplicateFile] target is required");
  }

  system.functions.fduplicate(target, source);
  return target;
}

/**
 * Duplicate toàn bộ record nguồn, ghi đè targetValues rồi insert record mới.
 * targetTable có thể bỏ trống nếu cùng bảng với sourceTable.
 * Không dùng hàm này để update record đã tồn tại.
 */
function duplicateAndInsertRecord(options) {
  var source = null;
  var target = null;

  try {
    if (!options) {
      throw new Error("[duplicateAndInsertRecord] options is required");
    }

    var sourceTable = options.sourceTable;
    var targetTable = options.targetTable || sourceTable;
    var sourceQuery = options.sourceQuery;
    var targetValues = options.targetValues || {};

    if (!sourceTable || !targetTable) {
      throw new Error("[duplicateAndInsertRecord] table name is required");
    }

    if (!sourceQuery) {
      throw new Error("[duplicateAndInsertRecord] sourceQuery is required");
    }

    source = new SCFile(sourceTable, SCFILE_READONLY);
    var rc = source.doSelect(sourceQuery);
    if (rc !== RC_SUCCESS) {
      return { success: false, message: "Source record not found", returnCode: rc };
    }

    target = new SCFile(targetTable);
    duplicateFile(source, target);

    for (var fieldName in targetValues) {
      if (Object.prototype.hasOwnProperty.call(targetValues, fieldName)) {
        target[fieldName] = targetValues[fieldName];
      }
    }

    rc = target.doInsert();
    if (rc !== RC_SUCCESS) {
      return { success: false, message: "Insert duplicated record failed", returnCode: rc };
    }

    return { success: true, message: "Record duplicated successfully", returnCode: rc };
  } catch (e) {
    print("[duplicateAndInsertRecord] " + e.message);
    return { success: false, message: e.message };
  } finally {
    try {
      if (source) {
        source.doClose();
      }
    } finally {
      if (target) {
        target.doClose();
      }
    }
  }
}

// Duplicate contact và insert thành record mới; chỉ chạy khi chủ động gọi.
// var result = duplicateAndInsertRecord({
//   sourceTable: "contacts",
//   sourceQuery: 'contact.name="falcon"',
//   targetValues: {
//     "contact.name": "falcon.copy",
//     "full.name": "Falcon Copy"
//   }
// });

// Update contact có sẵn; chỉ chạy khi chủ động gọi.
// var result = copyRecord({
//   action: "update",
//   sourceTable: "contacts",
//   sourceQuery: 'contact.name="falcon"',
//   sourceFields: ["full.name", "email", "phone"],
//   targetQuery: 'contact.name="falcon.copy"',
//   targetValues: { "full.name": "Falcon Updated" }
// });

// var result = copyAndInsertRecord({
//   sourceTable: "contacts",
//   sourceQuery: 'contact.name="falcon"',
//   sourceFields: ["full.name", "email", "phone"],
//   targetValues: {
//     "contact.name": "falcon.copy",
//     "full.name": "Falcon Copy"
//   }
// });

// var result = copyAndInsertRecord({
//   sourceTable: "contacts",
//   targetTable: "esdContactBackup",
//   sourceQuery: 'contact.name="falcon"',
//   sourceFields: ["contact.name", "full.name", "email"],
//   targetFields: ["contact.id", "display.name", "email.address"],
//   targetValues: {
//     "backup.id": "BACKUP-001",
//     "created.at": _tod(),
//     "created.by": _operator()
//   }
// });
