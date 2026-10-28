var writeSystemLog = lib.ESD_Utils.writeSystemLog;

/**
 * Tạo mới hoặc cập nhật schedule trong Service Manager.
 *
 * Mặc định:
 * - action.time = hiện tại + 1 giây
 * - expiration  = hiện tại + 2 giây
 * - repeat      = số giây (number), convert trực tiếp bằng funcs.val
 *
 * @param {Object} options - Cấu hình schedule
 * @param {string} options.scheduleName - Tên schedule
 * @param {string} options.jsCode - Đoạn JavaScript sẽ được scheduler thực thi
 * @param {number} options.repeat - Chu kỳ lặp (đơn vị: giây)
 * @param {number} [options.actionDelaySeconds=1] - Delay (giây) trước khi chạy lần đầu
 * @param {number} [options.expirationDelaySeconds=2] - Thời gian (giây) trước khi hết hạn
 *
 * @returns {void}
 */

function createSchedule(options) {
  var now = new Date();

  var scheduleName = options.scheduleName;
  var jsCode = options.jsCode || "";

  var repeatSeconds = options.repeat;
  if (typeof repeatSeconds !== "number" || repeatSeconds <= 0) {
    repeatSeconds = 3600; // default 1 giờ
  }

  var actionDelaySeconds =
    typeof options.actionDelaySeconds === "number"
      ? options.actionDelaySeconds
      : 1;
  var expirationDelaySeconds =
    typeof options.expirationDelaySeconds === "number"
      ? options.expirationDelaySeconds
      : 2;

  // ===== time =====
  var actionTime = new Date(now.getTime());
  actionTime.setSeconds(actionTime.getSeconds() + actionDelaySeconds);

  var expirationTime = new Date(now.getTime());
  expirationTime.setSeconds(
    expirationTime.getSeconds() + expirationDelaySeconds,
  );

  // ===== Check tồn tại =====
  var sche = new SCFile("schedule");
  var rc = sche.doSelect(`name="${scheduleName}"`);

  var isInsert = false;
  if (rc != RC_SUCCESS) {
    sche = new SCFile("schedule");
    sche.name = scheduleName;
    sche["class"] = "ESD_Schedule_Signature";
    sche.sched_class = "ESD_Schedule_Signature";
    isInsert = true;
  }

  try {
    // ===== repeat: truyền thẳng number vào funcs.val =====
    sche.repeat = funcs.val(repeatSeconds, 3);

    sche.expiration = expirationTime;
    sche["action.time"] = actionTime;

    // lưu start time
    sche.strings = ["startTime"];
    sche.strings1 = [String(now.getTime())];

    sche.status = isInsert ? "scheduled" : "rescheduled";
    sche.javascript = jsCode;

    // ===== save =====
    if (isInsert) {
      sche.doInsert();
    } else {
      sche.doUpdate();
    }

    writeSystemLog(
      "[ESD_SCHEDULE_Utils.createSchedule] Schedule created: " + scheduleName,
    );

    return true;
  } catch (e) {
    writeSystemLog(
      "[ESD_SCHEDULE_Utils.createSchedule] schedule created error: " +
        e.message,
    );
    return false;
  } finally {
    if (sche) sche.doClose();
  }
}
