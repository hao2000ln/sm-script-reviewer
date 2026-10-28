// setFields trên normal SCFile — đã track, nhưng chưa bật SM-SCF-006
var file = new SCFile("contacts", SCFILE_READONLY);
file.setFields("contact.name");