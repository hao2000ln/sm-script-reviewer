var $ = lib.c.$;

function getAttachmentDisplayName(fileName) {
  var value = String(fileName || "");

  if (value.length >= 2 && value.charAt(0) === '"' &&
      value.charAt(value.length - 1) === '"') {
    return value.substring(1, value.length - 1);
  }

  return value;
}

function getAttachmentByUid(application, recordId, uid) {
  if (!application) {
    throw new Error("[getAttachmentByUid] application is required");
  }

  if (!recordId) {
    throw new Error("[getAttachmentByUid] recordId is required");
  }

  if (!uid) {
    throw new Error("[getAttachmentByUid] uid is required");
  }

  var query = "application=:application and topic=:topic and uid=:uid and segment=0";

  return $("!SYSATTACHMENTS").fields(
    "uid", "application", "topic", "filename", "size", "mimetype",
    "type", "segment", "sysmodtime", "sysmoduser"
  )
    .find(query, application, recordId, uid).one();
}

function getAttachmentList(application, recordId) {
  if (!application) {
    throw new Error("[getAttachmentList] application is required");
  }

  if (!recordId) {
    throw new Error("[getAttachmentList] recordId is required");
  }

  var query = "application=:application and topic=:topic and segment=0";
  var rows = [];

  $("!SYSATTACHMENTS").fields(
    "uid", "application", "topic", "filename", "size", "mimetype",
    "type", "segment", "sysmodtime", "sysmoduser"
  ).find(query, application, recordId).each(function(attachment) {
    var fileName = getAttachmentDisplayName(attachment.filename);
    var linkAttachment = {
      uid: attachment.uid,
      filename: fileName,
      application: attachment.application,
      topic: attachment.topic
    };

    rows.push({
      uid: attachment.uid,
      application: attachment.application,
      recordId: attachment.topic,
      fileName: fileName,
      size: attachment.size,
      mimeType: attachment.mimetype,
      type: attachment.type,
      sysModTime: attachment.sysmodtime,
      sysModUser: attachment.sysmoduser,
      isAllowed: lib.AttachmentUtil.isAttachmentAllowed(attachment.filename),
      scattachUri: "scattach://" +
        lib.AttachmentUtil.getAttachmentLinkTag(linkAttachment)
    });
  });

  return rows;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAttachmentSize(size) {
  var value = Number(size) || 0;

  if (value < 1024) {
    return value + " B";
  }

  if (value < 1024 * 1024) {
    return (value / 1024).toFixed(1) + " KB";
  }

  return (value / (1024 * 1024)).toFixed(1) + " MB";
}

function formatAttachmentDate(value) {
  if (!value) {
    return "";
  }

  try {
    return new XMLDate(value).getISODateTimeString();
  } catch (e) {
    return String(value);
  }
}

function getAttachmentListHtml(application, recordId) {
  var rows = getAttachmentList(application, recordId);
  var html = [
    '<table class="TableResults" style="width:100%;border-collapse:collapse;">',
    '<thead><tr>',
    '<th class="TableHeading" style="text-align:left;padding:6px;">Tên tệp</th>',
    '<th class="TableHeading" style="text-align:right;padding:6px;">Dung lượng</th>',
    '<th class="TableHeading" style="text-align:left;padding:6px;">Người tải lên</th>',
    '<th class="TableHeading" style="text-align:left;padding:6px;">Ngày tải lên</th>',
    '</tr></thead><tbody>'
  ];

  if (rows.length === 0) {
    html.push(
      '<tr><td colspan="4" style="padding:8px;text-align:center;">',
      'Không có tệp đính kèm',
      '</td></tr>'
    );
  }

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var fileName = row.fileName;

    if (!row.isAllowed) {
      fileName += ".UNSAFE";
    }

    html.push(
      '<tr class="TableNormalRow">',
      '<td class="TableCellResults" style="padding:6px;">',
      '<a class="shadowFocus" href="', escapeHtml(row.scattachUri), '">',
      escapeHtml(fileName),
      '</a></td>',
      '<td class="TableCellResults" style="padding:6px;text-align:right;">',
      escapeHtml(formatAttachmentSize(row.size)),
      '</td>',
      '<td class="TableCellResults" style="padding:6px;">',
      escapeHtml(row.sysModUser),
      '</td>',
      '<td class="TableCellResults" style="padding:6px;">',
      escapeHtml(formatAttachmentDate(row.sysModTime)),
      '</td></tr>'
    );
  }

  html.push('</tbody></table>');
  return html.join("");
}

function testAttachmentListHtml(application, recordId) {
  var html = getAttachmentListHtml(application, recordId);
  print("[testAttachmentListHtml] " + html);
  return html;
}

var attachmentHtml = testAttachmentListHtml(
  "esdHDcontract",
  "HDMS_26_GT_DEMO_2309_2_01116"
);
