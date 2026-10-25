/** Lấy danh sách trạng thái theo điều kiện. */
function getStatusList(query) {
  var file = new SCFile('esdstatus');
  var rc = file.doSelect(query);
  while (rc == RC_SUCCESS) {
    rc = file.getNext();
  }
  file.doClose();
}
