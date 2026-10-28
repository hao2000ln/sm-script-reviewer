// Fetch data from a table based on SQL query and specified fields
function fetchData(tableName, sqlQuery, fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error(
      "[ESD_Utils.fetchData] fields must be a non-empty JavaScript array",
    );
  }
  let f = new SCFile(tableName, SCFILE_READONLY);
  try {
    f.setFields(fields);
    let rc = f.doSelect(sqlQuery);
    let data = [];
    if (rc == RC_SUCCESS) {
      do {
        data.push(getRowByFields(f, fields));
      } while (f.getNext() == RC_SUCCESS);
    }
    return lib.ESD_ArrObj_Utils.rmArrNull(data);
  } catch (e) {
    print("[ESD_Utils.fetchData] error: " + e.message);
  } finally {
    if (f) f.doClose();
  }
}