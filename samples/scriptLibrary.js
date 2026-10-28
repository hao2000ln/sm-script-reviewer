//3. dem so luong bản ghi trong bảng
function countFile(filename, query) {
  var file = new SCFile(filename, SCFILE_READONLY);
  var nCount = file.doCount(query);
  var rc = getLastRC();
  if (file) file.doClose();
  if (RC_SUCCESS == rc) {
    return nCount;
  } else {
    print("Could not count records. " + RCtoString(rc));
    return -1;
  }
}