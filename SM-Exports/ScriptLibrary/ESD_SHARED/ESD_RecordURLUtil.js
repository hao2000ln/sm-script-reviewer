var RECORD_WEB_URL_CONFIG = {
  contact: { tableName: "contacts", keyField: "contact.name" },
  incident: { tableName: "incidents", keyField: "incident.id" }
};

/**
 * Tao URL record tuong thich ESS, SRC va SMSP.
 *
 * recordType: key trong RECORD_WEB_URL_CONFIG; neu khong co config thi duoc xem la tableName.
 * recordId: ID record, dong thoi la id mac dinh cho SRC/SMSP.
 * options.keyField: field khoa cho case chua co config.
 * options.tableName: override tableName.
 * options.query: SM query day du cho composite key/dieu kien dac biet.
 * options.id: override ID dung cho SRC/SMSP.
 * options.recordTitle/displayValue/tableCaption: custom tieu de.
 */
function getRecordWebURL(recordType, recordId, options) {
  if (!recordType || recordId === undefined || recordId === null || recordId === "") {
    print("[getRecordWebURL] recordType and recordId are required");
    return null;
  }

  try {
    var type = String(recordType).toLowerCase();
    var config = RECORD_WEB_URL_CONFIG[type] || {};
    var custom = options || {};
    var tableName = custom.tableName || config.tableName || String(recordType);
    var keyField = custom.keyField || config.keyField;
    var query = custom.query;
    var id = custom.id;

    if (query === undefined || query === null || query === "") {
      if (!keyField) {
        throw new Error("[getRecordWebURL] keyField is required");
      }

      var safeId = lib.StringUtil.escapeAllStr(String(recordId));
      query = keyField + '="' + safeId + '"';
    }

    if (id === undefined || id === null || id === "") {
      id = recordId;
    }

    var recordTitle = custom.recordTitle;
    if (recordTitle === undefined || recordTitle === null) {
      var tableCaption = custom.tableCaption || system.functions.scmsg(tableName, "tablename");
      var displayValue = custom.displayValue || id;
      recordTitle = (tableCaption || tableName) + " " + displayValue;
    }

    return lib.urlCreator.getRecordURL(tableName, String(query), String(recordTitle), String(id));
  } catch (e) {
    print("[getRecordWebURL] error=" + e.message + " recordType=" + recordType + " recordId=" + recordId);
    return null;
  }
}

// var url = getRecordWebURL("probsummary", "C10001", 
//   {
//     query: 'number="C10001" and category="Change"',
//     recordTitle: "Change C10001"
//   }
// );
