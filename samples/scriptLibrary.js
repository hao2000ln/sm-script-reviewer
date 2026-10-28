// khai báo function
var createActivity = lib.ESD_Utils.createActivity;
var generateNextNumber = lib.ESD_Utils.generateNextNumber;
var CreateTicket = lib.ESD_Utils.CreateTicket;
var getDisplayNameField = lib.ESD_Utils.getDisplayNameField;
var isCountTicket = lib.ESD_Utils.isCountTicket;
var getCommonName = lib.ESD_Utils.getCommonName;

var toFloat = lib.ESD_HD_COMMON.toFloat;
var calculateAmount = lib.ESD_HD_COMMON.calculateAmount;
var calculateAmountGiaTri = lib.ESD_HD_COMMON.calculateAmountGiaTri;
/**
 * === DU LIEU CHO KHOI TAO KMS/GT ========
 * Lấy danh sách item.id đã sử dụng
 */
function getExistedMap() {
    var existedMap = {};
    var contractFile = new SCFile("esdHDcontract");
    var rcContract = contractFile.doSelect('item.id~=""');
    while (rcContract == RC_SUCCESS) {
        var itemId = contractFile["item.id"];
        if (itemId) {
            existedMap[itemId + ""] = true;
        }
        rcContract = contractFile.getNext();
    }
    return existedMap;
}

//update query = current.phase = "Theo doi"
function getDataFromKMSGT(type, executionBy, currentValue) {
    currentValue = String(currentValue || "");
    var existedMap = getExistedMap();

    // Bộ 1: Toàn bộ danh sách (cho màn hình Hợp đồng mua sắm)
    var allIds = [];
    var allNames = [];

    // Bộ 2: Chỉ quy trình < 100 triệu (cho màn hình KMS trực tiếp)
    var under100mIds = [];
    var under100mNames = [];

    var isTTMS = type === "TTMS";
    var under100mProcesses = {
        "01_04_01_01": true,
        "01_04_01_02": true,
        "02_03_01_01": true,
        "02_03_01_02": true
    };

    // Helper kiểm tra quy trình có phải < 100tr không
    function isProcessUnder100M(pkgRecord) {
        if (!pkgRecord) return false;
        var pkgId = String(pkgRecord["id"] || "");
        var targetTtmsId =
            pkgId.indexOf("TTMS") === 0 ?
            pkgId :
            String(pkgRecord["kms.id"] || pkgId);
        if (!targetTtmsId) return false;

        var fTtms = new SCFile("esdMSttms", SCFILE_READONLY);
        var rcTtms = fTtms.doSelect('id="' + targetTtmsId + '"');
        var isUnder = false;

        if (rcTtms === RC_SUCCESS) {
            var processId = String(fTtms["process.id"] || "");
            if (under100mProcesses[processId]) {
                isUnder = true;
            }
        }
        if (fTtms) fTtms.doClose();
        return isUnder;
    }

    // Helper đẩy dữ liệu vào 2 bộ mảng
    function pushItem(itemId, itemName, isUnder100M) {
        // 1. Luôn push vào danh sách chung (Hợp đồng mua sắm)
        allIds.push(itemId);
        allNames.push(itemName);

        // 2. Nếu < 100 triệu thì push thêm vào danh sách cho KMS trực tiếp
        if (isUnder100M) {
            under100mIds.push(itemId);
            under100mNames.push(itemName);
        }
    }

    var packageFile = new SCFile("esdMSkmsPackages");
    var rc = packageFile.doSelect(
        'type="' +
        type +
        '" and created.by="' +
        executionBy +
        '" and current.phase="Theo doi"'
    );

    while (rc == RC_SUCCESS) {
        var packageId = String(packageFile["id"] || "");
        var packageName = String(packageFile["name"] || "");
        var hasLots = packageFile["package.has.lots"];
        var isUnder = isTTMS ? isProcessUnder100M(packageFile) : false;

        // TH1: Gói không theo lô
        if (hasLots == false || hasLots == null) {
            if (!existedMap[packageId] || packageId == currentValue) {
                pushItem(packageId, packageId + " - " + packageName, isUnder);
            }
        }
        // TH2: Gói theo lô
        else {
            var lotFile = new SCFile("esdMSkmsPackageLot");
            var rcLot = lotFile.doSelect(
                'kms.package.id="' + packageId + '" and current.phase="Theo doi"'
            );
            while (rcLot == RC_SUCCESS) {
                var lotId = String(lotFile["id"] || "");
                var lotName = String(lotFile["name"] || "");
                if (!existedMap[lotId] || lotId == currentValue) {
                    pushItem(lotId, lotName, isUnder);
                }
                rcLot = lotFile.getNext();
            }
            if (lotFile) lotFile.doClose();
        }

        rc = packageFile.getNext();
    }
    if (packageFile) packageFile.doClose();

    // 2. DỮ LIỆU CHUYỂN ĐỔI (TRANFER)

    let lotTranferFile = new SCFile("esdMSkmsPackageLotTranfer");
    let packageTranferFile = new SCFile("esdMSkmsPackagesTranfer");
    let contractCheckFile = new SCFile("esdHDcontract");

    try {
        const baseTranferQuery = `execution.by="${executionBy}" and type="${type}"`;

        // Query 1: Gói thầu không theo lô
        const noLotQuery = `${baseTranferQuery} and status="Cho thuc hien" and (package.has.lots=false or package.has.lots=NULL)`;
        let noLotRc = packageTranferFile.doSelect(noLotQuery);
        while (noLotRc === RC_SUCCESS) {
            let packageTranferid = String(packageTranferFile["id"] || "");
            let packageTranfername = String(packageTranferFile["name"] || "");
            let isUnder = isTTMS ? isProcessUnder100M(packageTranferFile) : false;

            if (!existedMap[packageTranferid] || packageTranferid == currentValue) {
                pushItem(
                    packageTranferid,
                    packageTranferid + " - " + packageTranfername,
                    isUnder
                );
            }
            noLotRc = packageTranferFile.getNext();
        }

        // Query 2: Gói thầu theo lô
        const hasLotQuery = `${baseTranferQuery} and package.has.lots=true and status isin {"Cho thuc hien", "Dang thuc hien"}`;
        let hasLotRc = packageTranferFile.doSelect(hasLotQuery);
        while (hasLotRc === RC_SUCCESS) {
            let packageTranferid = String(packageTranferFile["id"] || "");
            let isUnder = isTTMS ? isProcessUnder100M(packageTranferFile) : false;

            // Bỏ lô đã hủy do chấm dứt HĐ (ESD_HD_DCBS_ACTION_RETURN.returnTranferDataOnTerminate)
            let rcTranferLot = lotTranferFile.doSelect(
                `kms.package.id="${packageTranferid}" and status~="Huy"`
            );
            while (rcTranferLot == RC_SUCCESS) {
                let lotTranferId = String(lotTranferFile["id"] || "");
                let lotTranferName = String(lotTranferFile["name"] || "");
                let isUsed =
                    contractCheckFile.doSelect(`item.id="${lotTranferId}"`) ===
                    RC_SUCCESS;

                if (!isUsed || lotTranferId == currentValue) {
                    pushItem(
                        lotTranferId,
                        `${lotTranferId} - ${lotTranferName}`,
                        isUnder
                    );
                }
                rcTranferLot = lotTranferFile.getNext();
            }
            hasLotRc = packageTranferFile.getNext();
        }
    } catch (e) {
        print(`Gặp lỗi khi xử lý hàm [getDataFromKMSGT]: ${e.message}`);
    } finally {
        if (lotTranferFile) lotTranferFile.doClose();
        if (packageTranferFile) packageTranferFile.doClose();
        if (contractCheckFile) contractCheckFile.doClose();
    }

    return {
        ids: allIds,
        names: allNames,
        allIds: allIds,
        allNames: allNames,
        under100mIds: under100mIds,
        under100mNames: under100mNames
    };
}

/**
 * ============================================================
 * Tổng giá trị mua sắm theo NCC - tai giai doan HHDV thuoc HD/GT
 * ============================================================
 */
function getPurchaseAmountBySupplier(contractId) {
    var resultObj = {};
    var f = new SCFile("esdHDcontractHHDV");
    var rc = f.doSelect('contract.id="' + contractId + '"');
    while (rc == RC_SUCCESS) {
        var supplierId = f["supplier"];
        // Thành tiền sau thuế quy đổi
        var amount = 0; //toFloat(calculateAmount(f).amountAfterTaxConvert);

        //Thêm điều kiện nghiệm thu/phân tách
        if (f.reference == "giaTri") {
            amount = toFloat(calculateAmountGiaTri(f).amountAfterTaxConvert);
        } else {
            amount = toFloat(calculateAmount(f).amountAfterTaxConvert);
        }

        // Nếu chưa tồn tại NCC
        if (!resultObj[supplierId]) {
            resultObj[supplierId] = 0;
        }
        // Cộng tiền
        resultObj[supplierId] += amount;
        rc = f.getNext();
    }

    return resultObj;
}
/**
 * ============================================================
 * Tổng giá trị HHDV mua sắm theo NCC - tai giai doan BBNT BAN GIAO HHDV
 * ============================================================
 */
function getExecutedAmountBySupplier(contractId) {
    var resultObj = {};
    var f = new SCFile("esdHDhandoverHHDV");
    var query =
        "SELECT d.* " +
        "FROM esdHDhandoverHHDV d " +
        "INNER JOIN esdHDhandover h " +
        "ON (d.ntbg.id = h.id) " +
        'WHERE d.contract.id="' +
        contractId +
        '" ' +
        'AND h.status="Hoan thanh"';

    try {
        var rc = f.doSelect(query);
        while (rc == RC_SUCCESS) {
            var supplierId = f["supplier"];
            var amount =
                f["reference"] == "giaTri" ?
                toFloat(calculateAmountGiaTri(f).amountAfterTaxConvert) :
                toFloat(calculateAmount(f).amountAfterTaxConvert);

            if (!resultObj[supplierId]) {
                resultObj[supplierId] = 0;
            }
            resultObj[supplierId] += amount;
            rc = f.getNext();
        }
        return resultObj;
    } finally {
        if (f) {
            f.doClose();
        }
    }
}

/**
 * Lấy danh sách HHDV theo gói thầu
 * update query = current.phase ="Theo doi"
 */
function layHHDVTheoGoiThau(packageId, category) {
    var result = [];
    var f = new SCFile("esdMSkmsHHDV");
    var query = "";
    if (category == "HD_KMS" || category == "HD_KMS_TTMS") {
//         const orgId = getDisplayNameField(
//            "esdMSkmsPackages",
//            `id="${packageId}"`,
//            "id",
//            "org.id"
//        );
//        query =
//            'org.id="' + orgId + '"' + ' and current.phase="Theo doi"';
        query =
            'kms.package.id="' + packageId + '"' + ' and current.phase="Theo doi"';
    } else {
        query = 'lot.id="' + packageId + '"' + ' and current.phase="Theo doi"';
        var rc = f.doSelect(query);
        if (rc != RC_SUCCESS) {
            query =
                'kms.package.id="' + packageId + '"' + ' and current.phase="Theo doi"';
        }
    }
    var rc = f.doSelect(query);
    while (rc == RC_SUCCESS) {
        result.push({
            id: f["id"],
            supplierId: f["supplier.id"],
            packageId: f["kms.package.id"],
            lotId: f["lot.id"],
            itemId: f["item.id"],
            hmcmId: f["hmcm.id"],
            taxOther: f["tax.other"],
            hhdvID: f["id"],
            hhdvName: f["hhdv.name"],
            hmcmId: f["hmcm.id"],
            quantity: f["quantity"],
            unitPrice: f["unit.price"],
            taxVatRate: f["tax.vat.rate"],
            currencyType: f["currency.type"],
            currencyRate: f["currency.rate"],
            yearlyAmount: f["yearly.amount"],
            itemGroup: f["item.group"],
            itemCategory: f["item.category"],
            itemType: f["item.type"],
            unitType: f["unit.type"],
            capitalSourceType: f["capital.source.type"]
        });
        rc = f.getNext();
    }
    return result;
}
/**
 * Them moi NCC, HHDV trong HD
 *
 * Update ngày 21/9 : Tích hợp thêm chức năng lấy dữ liệu từ luồng chuyển đổi dữ liệu
 * Original - Author : N/A
 * Update - Author : HoangNH03
 */

function insertDataKMSGT(record) {
    var recordID = record.id;
    var result = {
        success: false,
        message: ""
    };
    var date = system.functions.tod();
    try {
        // lấy dữ liệu bản ghi hiện tại
        var contractFile = new SCFile("esdHDcontract");
        var contractRc = contractFile.doSelect(`id="${recordID}"`);
        if (contractRc != 0) {
            result.message = `Không tìm thấy bản ghi id = "${recordID}" trong bảng esdHDcontract!`;
            return result;
        }

        // 1. Tao du lieu HHDV
        // Update 21/9 : Trong hàm này sẽ có thêm chức năng tìm cả dữ liệu trong
        // bảng chuyển đổi dữ liệu (esdMSkmsHHDVTranfer)
        // Lý do tách hàm : Để đảm bảo những nơi đã dùng hàm gốc sẽ k bị ảnh hưởng bởi thay đổi ở đây
        var hhdvList = layHHDVTheoGoiThauWithTranferData(
            record["item.id"],
            record["category"]
        );
        for (var i = 0; i < hhdvList.length; i++) {
            var currentItem = hhdvList[i];
            const nextNumberHHDV =
                lib.ESD_Utils.generateNextNumber("esdHDcontractHHDV");
            var itemFile = null;
            if (currentItem.itemId) {
                itemFile = new SCFile("esdKHpurchaseItem"); // gốc HHDV
                var rcItem = itemFile.doSelect('item.id="' + currentItem.itemId + '"');
                if (rcItem != RC_SUCCESS) {
                    itemFile = null;
                }
            }
            let idNextNumber = currentItem.itemId ?
                currentItem.itemId + "_" + nextNumberHHDV :
                currentItem.hhdvID + "_" + nextNumberHHDV;
            let payload = {
                id: idNextNumber,
                "created.at": date,
                "contract.id": recordID || "",
                "item.id": currentItem.itemId || "",
                "item.name": currentItem.hhdvName || "",
                "hhdv.id": currentItem.hhdvID || "",
                "hhdv.name": currentItem.hhdvName || "",
                //                'name': currentItem.hhdvName || "",
                supplier: currentItem.supplierId || "",
                "kms.package.id": currentItem.packageId || "",
                "lot.id": currentItem.lotId || "",
                quantity: currentItem.quantity || "",
                "item.unit": (itemFile ? itemFile["unit.measure"] : "") || currentItem.unitType, // don vi tinh
                "unit.price": String(currentItem.unitPrice || 0),
                "capital.source.type": (itemFile ? itemFile["fund.category"] : "") ||
                    currentItem.capitalSourceType ||
                    "", // itemFile ? itemFile["fund.category"] : "",
                "item.group": (itemFile ? itemFile["item.group"] : "") ||
                    currentItem.itemGroup ||
                    "",
                "item.model": (itemFile ? itemFile["item.type"] : "") ||
                    currentItem.itemCategory ||
                    "",
                "item.type": (itemFile ? itemFile["item.classification"] : "") ||
                    currentItem.itemType ||
                    "",
                "yearly.amount": currentItem.yearlyAmount || "",
                "currency.code": currentItem.currencyType ||
                    (itemFile ? itemFile["currency.type"] : "") ||
                    "",
                "vat.id": String(currentItem.taxVatRate || 0),
                "exchange.rate.id": (itemFile ? itemFile["exchange.rate"] : "") ||
                    currentItem.currencyRate ||
                    "",
                "pending.acceptance.quantity": currentItem.quantity || "",
                "pending.handover.quantity": currentItem.quantity || "",
                "accepted.technical.quantity": 0,
                "received.handover.quantity": 0,
                attribute: "HHTN",
                "money.tax.other": currentItem.moneyTaxOrther || 0,
                specifications: currentItem.specifications || "",
                note: currentItem.note || ""
            };

            //Tính toán tiền thuế VAT
            const resultVat = lib.ESD_HD_COMMON.calculateAmount(payload);
            payload["amount.before.tax"] = resultVat.amountBeforTax;
            if (resultVat.moneyTax) {
                payload["money.tax"] = resultVat.moneyTax;
            }
            lib.ESD_Utils.CreateTicket("esdHDcontractHHDV", payload);
        }

        // Cập nhật trạng thái của gói thầu/kms đang sử dụng là Đang thực hiện
        if (hhdvList.length > 0 && hhdvList[0].packageId) {
            var packageFile = new SCFile("esdMSkmsPackagesTranfer");
            if (
                packageFile.doSelect('id="' + hhdvList[0].packageId + '"') == RC_SUCCESS
            ) {
                packageFile["status"] = "Dang thuc hien";
                packageFile.doUpdate();
            }
        }

        //===========================================================================================
        //2. thêm dữ liệu Nhà cung cấp (còn được gọi là các nhà thầu trúng thầu)
        // mảng duy nhất chứa NCC: getUniqueOption
        let uniqueSuppliers = lib.ESD_Utils.getDataWithCondition(
            "esdHDcontractHHDV",
            "supplier",
            "contract.id",
            recordID
        );
        var supplierAmountMap = getPurchaseAmountBySupplier(recordID);
        for (var i = 0; i < uniqueSuppliers.length; i++) {
            var supplierId = uniqueSuppliers[i];
            var totalPurchaseAmount = toFloat(supplierAmountMap[supplierId]) || 0;
            var executedAmount = 0;
            var unexecutedAmount = totalPurchaseAmount - executedAmount;
            var paidAmount = 0;
            var unpaidAmount = executedAmount - paidAmount;
            var nextNumber = lib.ESD_Utils.generateNextNumber(
                "esdHDcontractSupplier"
            );
            var fields = {
                id: nextNumber,
                "created.at": date,
                "contract.id": recordID,
                "supplier.id": uniqueSuppliers[i],
                "supplier.name": getCommonName(
                    "esdDMSupplier",
                    `id="${uniqueSuppliers[i]}"`,
                    "name"
                ),
                "total.purchase.amount": String(totalPurchaseAmount),
                "paid.amount": String(paidAmount),
                "executed.amount": String(executedAmount),
                "unexecuted.amount": String(unexecutedAmount),
                "paid.amount": String(paidAmount),
                "unpaid.amount": String(unpaidAmount),
                "remaining.amount": String(totalPurchaseAmount)
            };
            lib.ESD_Utils.CreateTicket("esdHDcontractSupplier", fields);
        }
        result.success = true;
        return result;
    } catch (err) {
        result.message = err.message || "Unknown Err";
        return result;
    }
}

function insertDataTTMS(record) {
    var recordID = record.id;
    var result = { success: false, message: "" };
    var date = system.functions.tod();
    var contractFile = null;

    try {
        contractFile = new SCFile("esdHDcontract");
        var contractRc = contractFile.doSelect(`id="${recordID}"`);
        if (contractRc != RC_SUCCESS) {
            result.message = `Không tìm thấy bản ghi id = "${recordID}" trong bảng esdHDcontract!`;
            return result;
        }

        // Tạo dữ liệu HHDV
        var hhdvList =
            layHHDVTheoGoiThau(record["item.id"], record["category"]) || [];
        var totalContractValue = 0;

        for (var i = 0; i < hhdvList.length; i++) {
            var currentItem = hhdvList[i];

            var nextNumberHHDV =
                lib.ESD_Utils.generateNextNumber("esdHDcontractHHDV");

            var itemFile = null;

            if (currentItem.itemId) {
                itemFile = new SCFile("esdKHpurchaseItem");
                var rcItem = itemFile.doSelect('item.id="' + currentItem.itemId + '"');
                if (rcItem != RC_SUCCESS) {
                    itemFile = null;
                }
            }

            var idNextNumber = currentItem.hmcmId ?
                currentItem.hmcmId + "_" + nextNumberHHDV :
                currentItem.hhdvID + "_" + nextNumberHHDV;

            var payload = {
                id: idNextNumber,
                "created.at": date,
                "contract.id": recordID || "",
                "item.id": currentItem.itemId || "",
                "item.name": currentItem.hhdvName || "",
                "hhdv.id": currentItem.id || "",
                "hhdv.name": currentItem.hhdvName || "",
                "money.tax.other": currentItem.taxOther || "",
                supplier: "",
                "kms.package.id": currentItem.packageId || "",
                "lot.id": currentItem.lotId || "",
                quantity: currentItem.quantity || "",
                "item.unit": (itemFile ? itemFile["unit.measure"] : "") || currentItem.unitType,
                "unit.price": String(currentItem.unitPrice || 0),
                "capital.source.type": (itemFile ? itemFile["fund.category"] : "") ||
                    currentItem.capitalSourceType ||
                    "",
                "item.group": (itemFile ? itemFile["item.group"] : "") ||
                    currentItem.itemGroup ||
                    "",
                "item.model": (itemFile ? itemFile["item.type"] : "") ||
                    currentItem.itemCategory ||
                    "",
                "item.type": (itemFile ? itemFile["item.classification"] : "") ||
                    currentItem.itemType ||
                    "",
                "yearly.amount": currentItem.yearlyAmount || "",
                "currency.code": currentItem.currencyType ||
                    (itemFile ? itemFile["currency.type"] : "") ||
                    "",
                "vat.id": String(currentItem.taxVatRate || 0),
                "exchange.rate.id": (itemFile ? itemFile["exchange.rate"] : "") ||
                    currentItem.currencyRate ||
                    "",
                "pending.acceptance.quantity": currentItem.quantity || "",
                "pending.handover.quantity": currentItem.quantity || "",
                "accepted.technical.quantity": 0,
                "received.handover.quantity": 0,
                attribute: "HHTN"
            };

            var resultVat = lib.ESD_HD_COMMON.calculateAmount(payload);
            payload["amount.before.tax"] = resultVat.amountBeforTax;

            if (resultVat.moneyTax) {
                payload["money.tax"] = resultVat.moneyTax;
            }

            lib.ESD_Utils.CreateTicket("esdHDcontractHHDV", payload);

            var amountBeforeTax = Number(resultVat.amountBeforTax) || 0;
            var moneyTax = Number(resultVat.moneyTax) || 0;
            var rowTotal =
                Number(resultVat.amountAfterTax) || amountBeforeTax + moneyTax;

            totalContractValue += rowTotal;

            if (itemFile) {
                itemFile.doClose();
            }
        }

        //    contractFile["total.contract.value"] = totalContractValue;
        //    if (contractFile.doUpdate() != RC_SUCCESS) {
        //      result.message = `Lỗi cập nhật total.contract.value cho esdHDcontract id = "${recordID}"`;
        //      return result;
        //    }

        result.success = true;
        return result;
    } catch (err) {
        result.message = err.message || "Unknown Err";
        return result;
    } finally {
        if (contractFile) {
            contractFile.doClose();
        }
    }
}

//Tạo mới bản ghi cho NTCLKT
function createHDacceptance(record) {
    const tableName = "esdHDacceptance";
    var today = system.functions.tod();
    const payload = {
        id: record["execution.doc.no"],
        phase: record["phase"],
        "unit.lv1": record["unit.lv1"],
        "unit.lv2": record["unit.lv2"],
        "unit.lv3": record["unit.lv3"],
        "report.type": record["task.id"],
        "complete.date": record["complete.date"],
        "record.date": record["record.date"],
        "executor.id": record["executor.id"],
        status: "Tao moi",
        "contract.task.id": record["id"],
        "contract.id": record["contract.id"],
        "current.phase": "Tao moi",
        "inspection.count": 0,
        "hhdv.total.qualified": 0,
        "hhdv.total.fail": 0,
        "inspection.date": today,
        "total.acceptance.value": 0
    };

    lib.ESD_Utils.CreateTicket(tableName, payload);
}

// Xoa phieu thuc hien tai noi dung thuc hien
function clearContractTaskFields(contractTaskId, executionDocNo) {
    if (!contractTaskId) {
        return;
    }

    var f = new SCFile("esdHDcontractTask");
    var createActivity = lib.ESD_Utils.createActivity;
    var activityTable = "activityHDcontractTask";
    var type = "Xóa Phiếu thực hiện";
    try {
        var rc = f.doSelect(
            `id="${contractTaskId}" and execution.doc.no="${executionDocNo}"`
        );
        if (rc == RC_SUCCESS) {
            var content = "Phiếu thực hiện #" + f["execution.doc.no"] + " đã bị xóa";
            f["execution.doc.no"] = null;
            f["actual.date"] = null;
            f["completed.date"] = null;
            f["status.ticket"] = null;
            f["status"] = "Cho thuc hien";
            f["current.phase"] = "Thuc hien";
            f.doUpdate();
            createActivity(activityTable, content, contractTaskId, type);
        }
    } catch (e) {
        print(
            "ScriptLibrary: ESD_HD_ACTION_WF[clearContractTaskFields] error: " +
            e.message
        );
    } finally {
        if (f) f.doClose();
    }
}
// Xoa phieu thuc hien tai noi dung thuc hien NTTT
function clearContractTaskFieldsNTTT(contractId) {
    if (!contractId) {
        return;
    }

    var f = new SCFile("esdHDcontractTask");
    var createActivity = lib.ESD_Utils.createActivity;
    var activityTable = "activityHDcontractTask";
    var type = "Xóa Phiếu thực hiện";
    try {
        var rc = f.doSelect(`task.id="NTTT" and contract.id="${contractId}"`);
        if (rc == RC_SUCCESS) {
            var content = "Phiếu thực hiện #" + f["execution.doc.no"] + " đã bị xóa";
            f["execution.doc.no"] = null;
            f["actual.date"] = null;
            f["completed.date"] = null;
            f["status.ticket"] = null;
            f["status"] = "Cho thuc hien";
            f["current.phase"] = "Thuc hien";
            f.doUpdate();
            createActivity(activityTable, content, f["id"], type);
        }
    } catch (e) {
        print(
            "ScriptLibrary: ESD_HD_ACTION_WF[clearContractTaskFieldsNTTT] error: " +
            e.message
        );
    } finally {
        if (f) f.doClose();
    }
}

// Sync contract task field when update status acceptances
function syncContractTaskFields(record, oldrecord, source) {
    var contractTaskId = record["contract.task.id"];
    if (!contractTaskId) return;

    var currentStatus = String(record["status"]);

    // Mapping field theo từng màn
    var FIELD_MAPPING = [{ from: "status", to: "status.ticket" }];

    if (source === "ntkt") {
        // esdHDacceptance
        FIELD_MAPPING.push({ from: "inspection.date", to: "actual.date" });
        if (currentStatus === "Hoan thanh") {
            FIELD_MAPPING.push({ from: "complete.date", to: "completed.date" });
        }
    } else if (source === "BGHHDV") {
        // esdHDhandover
        FIELD_MAPPING.push({ from: "receive.date", to: "actual.date" });
        if (currentStatus === "Da hoan tat ban giao") {
            FIELD_MAPPING.push({ from: "completed.date", to: "completed.date" });
        }
    } else if (source === "TKHHDV") {
        // esdHDhandover
        FIELD_MAPPING.push({ from: "deployment.date", to: "actual.date" });
        if (currentStatus === "Hoan thanh trien khai") {
            FIELD_MAPPING.push({ from: "completed.date", to: "completed.date" });
        }
    } else if (source === "NTTT") {
        // esdHDfinalAcceptance
        FIELD_MAPPING.push({
            from: "date.of.overall.acceptance",
            to: "actual.date"
        });
        if (currentStatus === "Hoan thanh") {
            FIELD_MAPPING.push({ from: "complete.date", to: "completed.date" });
        }
    } else if (source === "TLHD") {
        // esdHDliquidation
        FIELD_MAPPING.push({ from: "liquidation.date", to: "actual.date" });
        if (currentStatus === "Hoan thanh") {
            FIELD_MAPPING.push({ from: "complete.date", to: "completed.date" });
        }
    }

    // Mapping status -> current.phase
    var STATUS_PHASE_MAPPING = {
        "Hoan thanh": { status: "Hoan thanh", phase: "Hoan thanh" },
        "Da hoan tat ban giao": { status: "Hoan thanh", phase: "Hoan thanh" },
        "Cho xac nhan nghiem thu CLKT": {
            status: "Cho xac nhan",
            phase: "Cho xac nhan"
        },
        "Cho chinh sua thong tin nghiem thu CLKT": {
            status: "Cho chinh sua",
            phase: "Cho chinh sua"
        },
        "Tao moi": { status: "Cho thuc hien", phase: "Thuc hien" },
        "Cho xac nhan BB ban giao": {
            status: "Cho xac nhan",
            phase: "Cho xac nhan"
        },
        "Cho chinh sua bien ban": {
            status: "Cho chinh sua",
            phase: "Cho chinh sua"
        },
        //yctk
        "Hoan thanh trien khai": { status: "Hoan thanh", phase: "Hoan thanh" },
        "Dang thuc hien trien khai": {
            status: "Dang thuc hien trien khai",
            phase: "Thuc hien"
        },
        "Cho chinh sua YCTK": { status: "Cho chinh sua YCTK", phase: "Chinh sua" },
        //NTTT
        "Cho xac nhan NTTT": {
            status: "Cho xac nhan NTTT",
            phase: "Cho xac nhan NTTT"
        },
        "Cho chinh sua thong tin NTTT": {
            status: "Cho chinh sua thong tin NTTT",
            phase: "Cho chinh sua thong tin NTTT"
        },
        "Hoan thanh": { status: "Hoan thanh", phase: "Hoan thanh" },
        //TLHD
        "Cho xac nhan thanh ly hop dong": {
            status: "Cho xac nhan thanh ly hop dong",
            phase: "Cho xac nhan thanh ly hop dong"
        },
        "Cho chinh sua thong tin thanh ly hd": {
            status: "Cho chinh sua thong tin thanh ly hd",
            phase: "Cho chinh sua thong tin thanh ly hd"
        }
    };

    var f = new SCFile("esdHDcontractTask");
    try {
        var rc = f.doSelect(`id="${contractTaskId}"`);
        if (rc != RC_SUCCESS) {
            return;
        }

        // Sync field - chỉ update khi có giá trị
        for (var j = 0; j < FIELD_MAPPING.length; j++) {
            var field = FIELD_MAPPING[j];
            if (record[field.from]) {
                f[field.to] = record[field.from];
            }
        }

        var isMatchedStatus =
            (source === "ntkt" && currentStatus === "Hoan thanh") ||
            (source === "BGHHDV" && currentStatus === "Da hoan tat ban giao") ||
            (source === "TKHHDV" && currentStatus === "Hoan thanh trien khai") ||
            (source === "NTTT" && currentStatus === "Hoan thanh") ||
            (source === "TLHD" && currentStatus === "Hoan thanh");

        if (isMatchedStatus && STATUS_PHASE_MAPPING[currentStatus]) {
            f["status"] = STATUS_PHASE_MAPPING[currentStatus].status;
            f["current.phase"] = STATUS_PHASE_MAPPING[currentStatus].phase;
        }

        if (source === "TKHHDV" && currentStatus === "Hoan thanh trien khai") {
            f["actual.amount"] = record["total.amount.convert"];
            f["currency.code.ticket"] = "VND";
        }
        if (source === "NTTT" && currentStatus === "Hoan thanh") {
            f["actual.amount"] = record["total.settlement.amount"];
            f["currency.code.ticket"] = "VND";
        }

        if (source === "TLHD" && currentStatus === "Hoan thanh") {
            //             f["actual.amount"] = record['total.settlement.amount'];
            f["currency.code.ticket"] = "VND";
        }

        f.doUpdate();
    } catch (e) {
        print(
            "ScriptLibrary: ESD_HD_ACTION_WF[syncContractTaskFields] error: " +
            e.message
        );
    } finally {
        if (f) f.doClose();
    }
}

// validate ngay thuc hien clkt > ngay hoan thanh
function validateInspectionDate(file) {
    var today = system.functions.tod();
    var inspectionDate = file["inspection.date"];
    var compareDate = file["complete.date"] ? file["complete.date"] : today;

    if (compareDate && inspectionDate > compareDate) {
        return {
            valid: false,
            error: "Ngày thực hiện nghiệm thu CLKT phải nhỏ hơn Ngày hoàn thành",
            field: "inspection.date"
        };
    }

    return { valid: true };
}

// sync HHDV nghiem thu
function syncHHDVStatus(record) {
    var ntclktId = record["id"];
    var status = record["status"];

    if (!ntclktId) {
        return;
    }

    // Mapping status -> current.phase của esdHDacceptanceHHDV
    var PHASE_MAPPING = {
        "Tao moi": "Tao moi",
        "Cho chinh sua thong tin nghiem thu CLKT": "Tao moi",
        "Cho xac nhan nghiem thu CLKT": "Thuc hien",
        "Hoan thanh": "Thuc hien"
    };

    var nextPhase = PHASE_MAPPING[status];
    if (!nextPhase) {
        return;
    }

    var f = new SCFile("esdHDacceptanceHHDV");
    try {
        var rc = f.doSelect(`ntclkt.id="${ntclktId}"`);
        if (rc != RC_SUCCESS) {
            return;
        }

        var count = 0;
        while (rc == RC_SUCCESS) {
            f["current.phase"] = nextPhase;
            f.doUpdate();
            count++;
            rc = f.getNext();
        }
    } catch (e) {
        print(
            "ScriptLibrary: ESD_HD_ACCEPTANCE_ACTION_WF[syncHHDVStatus] error: " +
            e.message
        );
    } finally {
        if (f) f.doClose();
    }
}

// update number inspection
function updateInspectionAndContractTask(record) {
    if (!record || !record["id"]) {
        print("[updateInspectionAndContractTask] Record hoặc id không hợp lệ");
        return;
    }

    const toFloat = lib.ESD_Utils.toFloat;
    const roundMath = lib.ESD_Utils.roundMath;
    const formatMoneyView = lib.ESD_Utils.formatCurrency;

    var ntclktId = record["id"];
    var contractTaskId = record["contract.task.id"];
    const activityTable = "activityHDcontractHHDV";
    const type = "Cập nhật";
    var fHhdv = new SCFile("esdHDacceptanceHHDV");
    var totalAmountAfterTaxConvert = 0;

    try {
        var rc = fHhdv.doSelect(`ntclkt.id="${ntclktId}"`);

        while (rc == RC_SUCCESS) {
            var contractHhdvId = fHhdv["contract.hhdv.id"];
            var totalPass = Number(fHhdv["total.pass"]) || 0;
            var quantity = Number(fHhdv["quantity"]) || 0;

            //            let acceptedTechnicalValue =
            //                toFloat(fHhdv["accepted.technical.value"]) || 0; //Giá trị đã nghiệm thu CLKT
            //            let pendingAcceptanceValue =
            //                toFloat(fHhdv["pending.acceptance.value"]) || 0; //Giá trị chưa nghiệm thu CLKT

            // =========================
            // Update esdHDcontractHHDV
            // =========================
            if (contractHhdvId) {
                var fContract = new SCFile("esdHDcontractHHDV");
                try {
                    var rcContract = fContract.doSelect(`id="${contractHhdvId}"`);

                    // Chỉ khi tìm thấy contract
                    if (rcContract == RC_SUCCESS) {
                        //Phần tính số lượng
                        var acceptedQty =
                            Number(fContract["accepted.technical.quantity"]) || 0;

                        var contractQty = Number(fContract["quantity"]) || 0;

                        var newAcceptedQty = acceptedQty + totalPass;

                        fContract["accepted.technical.quantity"] = newAcceptedQty;

                        fContract["pending.acceptance.quantity"] =
                            contractQty - newAcceptedQty;

                        fContract.doUpdate();
                        createActivity(
                            activityTable,
                            `Biên bản NTCLKT ${ntclktId} thay đổi Số lượng nghiệm thu CLKT: ${acceptedQty} → ${newAcceptedQty}`,
                            contractHhdvId,
                            type
                        );
                        createActivity(
                            activityTable,
                            `Biên bản NTCLKT ${ntclktId} thay đổi Số lượng chưa nghiệm thu CLKT: ${contractQty} → ${contractQty - newAcceptedQty}`,
                            contractHhdvId,
                            type
                        );


                        // =========================
                        // Tính amountAfterTaxConvert cho từng HHDV
                        // =========================

                        var calcResult =
                            lib.ESD_HD_COMMON.calcMoneyWithRateOfNumberAcceptanceAndTotalConvert(
                                fHhdv
                            );
                        totalAmountAfterTaxConvert += calcResult.amountAfterTaxConvert;

                    }
                } finally {
                    fContract.doClose();
                }
            }

            rc = fHhdv.getNext();
        }
    } finally {
        fHhdv.doClose();
    }

    // =========================
    // Update actual.amount
    // =========================
    if (contractTaskId) {
        var fTask = new SCFile("esdHDcontractTask");

        try {
            var rcTask = fTask.doSelect(`id="${contractTaskId}"`);
            if (rcTask == RC_SUCCESS) {
                fTask["actual.amount"] = record["total.acceptance.value"];
                fTask["currency.code.ticket"] = "VND";
                fTask.doUpdate();
            }
        } finally {
            fTask.doClose();
        }
    }
}

// Update Số lượng đã nhận bàn giao, chưa nhận bàn giao
// Và cập nhật số lượng nghiệm thu CLKT nếu inspection.type = out
function updateSoLuongBanGiaoHopDong(record, isUpdateContractTask = true) {
    if (!record || !record["id"]) {
        print("[updateSoLuongBanGiaoHopDong] Record hoặc id không hợp lệ");
        return;
    }
    const roundMath = lib.ESD_Utils.roundMath;
    const formatMoneyView = lib.ESD_Utils.formatCurrency;
    const toFloat = lib.ESD_Utils.toFloat;
    var ntbgId = record["id"];
    var contractTaskId = record["contract.task.id"];

    // =====================================
    // Lấy inspection.type của biên bản NTBG
    // =====================================
    var inspectionType = "";
    var activityTable = "activityHDcontractHHDV";
    var type = "Cập nhật";
    var fNTBG = new SCFile("esdHDhandover");
    let reportName = "";

    try {
        if (fNTBG.doSelect(`id="${ntbgId}"`) == RC_SUCCESS) {
            inspectionType = fNTBG["inspection.type"] || "";
            let category = fNTBG["category"] || "";
            if (category == "BGHHDV") {
                reportName = "Biên bản NTBG";
            } else if (category == "TKHHDV") {
                reportName = "Biên bản YCTK";
            }
        }
    } finally {
        if (fNTBG) {
            fNTBG.doClose();
        }
    }
    // =====================================
    // Duyệt danh sách HHDV của biên bản
    // =====================================
    var fHhdv = new SCFile("esdHDhandoverHHDV");

    try {
        var rc = fHhdv.doSelect(`ntbg.id="${ntbgId}"`);

        while (rc == RC_SUCCESS) {
            var contractHhdvId = fHhdv["contract.hhdv.id"];
            var acceptedHandoverQty =
                Number(fHhdv["accepted.handover.quantity"]) || 0;
            if (contractHhdvId) {
                var fContract = new SCFile("esdHDcontractHHDV");

                try {
                    var rcContract = fContract.doSelect(`id="${contractHhdvId}"`);

                    if (rcContract == RC_SUCCESS) {
                        let acceptedTechnicalValue =
                            toFloat(fContract["accepted.technical.value"]) || 0; //Giá trị đã nghiệm thu CLKT
                        let pendingAcceptanceValue =
                            toFloat(fContract["pending.acceptance.value"]) || 0; //Giá trị chưa nghiệm thu CLKT
                        let receivedHandoverValue =
                            toFloat(fContract["received.handover.value"]) || 0; //Giá trị đã nhận bàn giao
                        let pendingHandoverValue =
                            toFloat(fContract["pending.handover.value"]) || 0; //Giá trị chưa nhận bàn giao

                        let giaTri = null;
                        if (fContract.reference == "giaTri") {
                            giaTri = lib.ESD_HD_COMMON.calculateAmountHHDVGiaTri(fHhdv);
                        } else giaTri = lib.ESD_HD_COMMON.calculateAmountBGHHDV(fHhdv);
                        const amountTotalAmountConvert = giaTri.amountAfterTaxConvertHHDV; //Thành tiền sau thuế quy đổi

                        //Trong hệ thống NTCLKT
                        //Tăng số tiền đã bàn giao
                        fContract["received.handover.value"] =
                            receivedHandoverValue + amountTotalAmountConvert;
                        //Giảm số tiền chưa bàn giao
                        fContract["pending.handover.value"] =
                            pendingHandoverValue - amountTotalAmountConvert;

                        //Cập nhật lịch sử
                        let text = `${reportName} ${ntbgId} thay đổi giá trị đã nhận bàn giao: ${formatMoneyView(roundMath(receivedHandoverValue, 2))} → ${formatMoneyView(roundMath(fContract["received.handover.value"], 2))}`;
                        createActivity(activityTable, text, contractHhdvId, type);
                        text = `${reportName} ${ntbgId} thay đổi giá trị chưa nhận bàn giao: ${formatMoneyView(roundMath(pendingHandoverValue, 2))} → ${formatMoneyView(roundMath(fContract["pending.handover.value"], 2))}`;
                        createActivity(activityTable, text, contractHhdvId, type);

                        var contractQty = Number(fContract["quantity"]) || 0;
                        // =========================
                        // Số lượng đã nhận bàn giao
                        // =========================
                        var receivedHandoverQty =
                            Number(fContract["received.handover.quantity"]) || 0;

                        var newReceivedHandoverQty =
                            receivedHandoverQty + acceptedHandoverQty;

                        fContract["received.handover.quantity"] = newReceivedHandoverQty;

                        fContract["pending.handover.quantity"] =
                            contractQty - newReceivedHandoverQty;
                        createActivity(
                            activityTable,
                            `${reportName} ${ntbgId} thay đổi Số lượng nhận bàn giao: ${receivedHandoverQty} → ${newReceivedHandoverQty}`,
                            contractHhdvId,
                            type
                        );
                        createActivity(
                            activityTable,
                            `${reportName} ${ntbgId} thay đổi Số lượng chưa nhận bàn giao: ${contractQty} → ${contractQty - newReceivedHandoverQty}`,
                            contractHhdvId,
                            type
                        );
                        // =========================
                        // Nếu NTBG loại đính kèm thông tin ngoài hệ thống
                        // =========================
                        if (inspectionType == "out") {
                            //Xử lý update số lượng
                            var acceptedTechnicalQty =
                                Number(fContract["accepted.technical.quantity"]) || 0;
                            var newAcceptedTechnicalQty =
                                acceptedTechnicalQty + acceptedHandoverQty;

                            fContract["accepted.technical.quantity"] =
                                newAcceptedTechnicalQty;

                            fContract["pending.acceptance.quantity"] =
                                contractQty - newAcceptedTechnicalQty;
                            createActivity(
                                activityTable,
                                `${reportName} ${ntbgId} thay đổi Số lượng nghiệm thu CLKT: ${acceptedTechnicalQty} → ${newAcceptedTechnicalQty}`,
                                contractHhdvId,
                                type
                            );
                            createActivity(
                                activityTable,
                                `${reportName} ${ntbgId} thay đổi Số lượng chưa nghiệm thu CLKT: ${contractQty} → ${contractQty - newAcceptedTechnicalQty}`,
                                contractHhdvId,
                                type
                            );

                        }
                        fContract.doUpdate();
                    }
                } finally {
                    if (fContract) {
                        fContract.doClose();
                    }
                }
            }
            rc = fHhdv.getNext();
        }
    } finally {
        if (fHhdv) {
            fHhdv.doClose();
        }
    }
    // =====================================
    // Update actual.amount cho Contract Task
    // =====================================
    if (contractTaskId && isUpdateContractTask) {
        var fTask = new SCFile("esdHDcontractTask");

        try {
            var rcTask = fTask.doSelect(`id="${contractTaskId}"`);

            if (rcTask == RC_SUCCESS) {
                fTask["actual.amount"] = record["total.amount.convert"];
                fTask["currency.code.ticket"] = "VND";
                fTask.doUpdate();
            }
        } finally {
            if (fTask) {
                fTask.doClose();
            }
        }
    }
}

// update tong so luong kiem dinh, so luong pass, fail cua bien ban nghiem thu
function updateBienBanNghiemThu(ntclktId) {
    const toFloat = lib.ESD_Utils.toFloat;
    var totalQuantity = 0;
    var totalPass = 0;
    var totalFail = 0;
    let totalAcceptanceValue = 0;
    var fHhdv = new SCFile("esdHDacceptanceHHDV");
    try {
        var rc = fHhdv.doSelect(`ntclkt.id="${ntclktId}"`);
        while (rc == RC_SUCCESS) {
            if (fHhdv.reference == "giaTri") {
                const giaTri = lib.ESD_HD_COMMON.calculateAmountGiaTri(fHhdv);
                totalAcceptanceValue += toFloat(giaTri.amountAfterTaxConvert);
            } else {
                totalQuantity += Number(fHhdv["quantity"]) || 0;
                totalPass += Number(fHhdv["total.pass"]) || 0;
                totalFail += Number(fHhdv["total.fail"]) || 0;

                fHhdv["quantity"] = fHhdv["total.pass"];
                const giaTriSoLuong = lib.ESD_HD_COMMON.calculateAmount(fHhdv);
                totalAcceptanceValue += toFloat(giaTriSoLuong.amountAfterTaxConvert);
            }
            rc = fHhdv.getNext();
        }
    } catch (e) {
        print(
            "ESD_HD_ACTION_WF[updateAcceptanceSummary] error fHhdv: " + e.message
        );
    } finally {
        if (fHhdv) fHhdv.doClose();
    }

    // Update lại esdHDacceptance
    var fAcceptance = new SCFile("esdHDacceptance");
    try {
        var rcAcceptance = fAcceptance.doSelect(`id="${ntclktId}"`);
        if (rcAcceptance == RC_SUCCESS) {
            fAcceptance["inspection.count"] = totalQuantity;
            fAcceptance["hhdv.total.qualified"] = totalPass;
            fAcceptance["hhdv.total.fail"] = totalFail;
            fAcceptance["total.acceptance.value"] = totalAcceptanceValue;
            fAcceptance.doUpdate();
        }
    } catch (e) {
        print(
            "ESD_HD_ACTION_WF[updateAcceptanceSummary] error fAcceptance: " +
            e.message
        );
    } finally {
        if (fAcceptance) fAcceptance.doClose();
    }
}

function updateBienBanBanGiao(ntbgId) {
    var totalHandoverQuantity = 0;
    var fHhdv = new SCFile("esdHDhandoverHHDV");
    try {
        var rc = fHhdv.doSelect('ntbg.id="' + ntbgId + '"');
        while (rc == RC_SUCCESS) {
            totalHandoverQuantity += Number(fHhdv["accepted.handover.quantity"]) || 0;
            rc = fHhdv.getNext();
        }
    } catch (e) {
        print("ESD_HD_ACTION_WF[updateBienBanBanGiao] error fHhdv: " + e.message);
    } finally {
        if (fHhdv) fHhdv.doClose();
    }

    // Update lại esdHDhandover (biên bản nghiệm thu bàn giao)
    var fHandover = new SCFile("esdHDhandover");
    try {
        var rcHandover = fHandover.doSelect('id="' + ntbgId + '"');
        if (rcHandover == RC_SUCCESS) {
            fHandover["total.quantity"] = totalHandoverQuantity;
            fHandover.doUpdate();
        }
    } catch (e) {
        print(
            "ESD_HD_ACTION_WF[updateBienBanBanGiao] error fHandover: " + e.message
        );
    } finally {
        if (fHandover) fHandover.doClose();
    }
}

function updateThucHienTrienKhai(ntbgId) {
    var totalHandoverQuantity = 0;
    var fHhdv = new SCFile("esdHDhandoverHHDV");
    try {
        var rc = fHhdv.doSelect('ntbg.id="' + ntbgId + '"');
        while (rc == RC_SUCCESS) {
            totalHandoverQuantity += Number(fHhdv["pending.handover.quantity"]) || 0;
            rc = fHhdv.getNext();
        }
    } catch (e) {
        print("ESD_HD_ACTION_WF[updateBienBanBanGiao] error fHhdv: " + e.message);
    } finally {
        if (fHhdv) fHhdv.doClose();
    }

    // Update lại esdHDhandover (biên bản nghiệm thu bàn giao)
    var fHandover = new SCFile("esdHDhandover");
    try {
        var rcHandover = fHandover.doSelect('id="' + ntbgId + '"');
        if (rcHandover == RC_SUCCESS) {
            fHandover["total.quantity"] = totalHandoverQuantity;
            fHandover.doUpdate();
        }
    } catch (e) {
        print(
            "ESD_HD_ACTION_WF[updateBienBanBanGiao] error fHandover: " + e.message
        );
    } finally {
        if (fHandover) fHandover.doClose();
    }
}

function updateExecutionLiquidation(record) {
    const contractTaskId = record["contract.task.id"];
    const id = record["id"];
    if (contractTaskId) {
        var fTask = new SCFile("esdHDcontractTask");
        var fContract = new SCFile("esdHDcontract");
        var file = new SCFile("esdHDliquidation");
        try {
            var rc = file.doSelect(`id="${id}"`);
            var rcTask = fTask.doSelect(`id="${contractTaskId}"`);
            if (rcTask == RC_SUCCESS) {
                fTask["actual.amount"] = record["total.settlement.value"];
                fTask["currency.code.ticket"] = "VND";
                fTask["status.ticket"] = record["status"];
                fTask["actual.date"] = record["liquidation.date"];
                fTask["completed.date"] = record["completed.date"];
                fTask.doUpdate();
            }
            var rcContract = fContract.doSelect(`id="${record["contract.id"]}"`);
            if (rcContract == RC_SUCCESS) {
                if (fContract["contract.end.date"] == "HTTLHD") {
                    fContract["current.phase"] = "Dong";
                    fContract["status"] = "Hoan thanh";
                    fContract["actual.end.date"] = system.functions.tod();
                    fContract.doUpdate();
                    createActivity(
                        "activityHDcontract",
                        "Hoàn thành",
                        record["contract.id"],
                        "Hoàn thành"
                    );
                }
            }
        } finally {
            fTask.doClose();
        }
    }
}

//Xóa phieu.id trong HHDV HĐ/KMS
function updateContractHHDV(phieuId) {
    let fHhdv = new SCFile("esdHDcontractHHDV");
    try {
        let rc = fHhdv.doSelect(`phieu.id="${phieuId}"`);
        while (rc == RC_SUCCESS) {
            fHhdv["phieu.id"] = null;

            fHhdv.doUpdate();
            rc = fHhdv.getNext();
        }
    } catch (e) {
        print("Đã có lỗi xả ra: " + e.message);
    }
}
//Xóa phieu.id trong serial origin của các HHDV đã được thêm vào biên bản
function updateSerialOrigin(phieuId) {
    let f = new SCFile("esdHDserialOrigin");
    try {
        let rc = f.doSelect(`phieu.id="${phieuId}"`);
        while (rc == RC_SUCCESS) {
            f["phieu.id"] = null;

            f.doUpdate();
            rc = f.getNext();
        }
    } catch (e) {
        print("Đã có lỗi xả ra: " + e.message);
    }
}

function getDateExecution(kms) {
    const sql = `kms.id="${kms}" and task.code="O_01"`;
    const date = getDisplayNameField(
        "esdMSkmsTaskStep",
        sql,
        "id",
        "execution.start.date"
    );
    return date;
}

// Origin - Author : HoangNH03
// Hàm lấy dữ liệu HHDV theo gói thầu và có tính thêm cả dữ liệu của luồng chuyển đổi dữ liệu
function layHHDVTheoGoiThauWithTranferData(packageId, category) {
    var result = [];

    function mappingHHDVData(file) {
        const techNote = file["tech.note"].join(", ") || file["tech.note"] || "";
        const note = file["note"].join(", ") || file["note"] || "";

        return {
            id: file["id"],
            supplierId: file["supplier.id"],
            packageId: file["kms.package.id"],
            lotId: file["lot.id"],
            itemId: file["item.id"],
            hhdvID: file["id"],
            hhdvName: file["hhdv.name"],
            quantity: file["quantity"],
            unitPrice: file["unit.price"],
            taxVatRate: file["tax.vat.rate"],
            currencyType: file["currency.type"],
            currencyRate: file["currency.rate"],
            yearlyAmount: file["yearly.amount"],
            itemGroup: file["item.group"],
            itemCategory: file["item.category"],
            // Fall back đổi sang trường product.category nếu không có item.type
            itemType: String(file["item.type"] || "").trim() || file["product.category"],
            unitType: file["unit.type"],
            capitalSourceType: file["capital.source.type"],
            moneyTaxOrther: file["tax.other"],
            specifications: techNote,
            note: note
        };
    }

    var packageIdOrigin = "";

    var packageSources = [{
            name: "esdMSkmsPackages",
            file: new SCFile("esdMSkmsPackages")
        },
        {
            name: "esdMSkmsPackageLot",
            file: new SCFile("esdMSkmsPackageLot")
        },
        {
            name: "esdMSkmsPackagesTranfer",
            file: new SCFile("esdMSkmsPackagesTranfer")
        },
        {
            name: "esdMSkmsPackageLotTranfer",
            file: new SCFile("esdMSkmsPackageLotTranfer")
        }
    ];

    try {
        var checkQuery = `id="${packageId}"`;

        for (var i = 0; i < packageSources.length; i++) {
            var rc = packageSources[i].file.doSelect(checkQuery);
            if (rc === RC_SUCCESS) {
                packageIdOrigin = packageSources[i].name;
                break;
            }
        }
    } catch (e) {
        print(
            "[layHHDVTheoGoiThauWithTranferData] Lỗi xác định nguồn package: " +
            e.message
        );
        return result;
    } finally {
        for (var i = 0; i < packageSources.length; i++) {
            if (packageSources[i].file) {
                packageSources[i].file.doClose();
            }
        }
    }

    // =====================================================
    // Dữ liệu gốc
    // =====================================================

    if (
        packageIdOrigin !== "esdMSkmsPackagesTranfer" &&
        packageIdOrigin !== "esdMSkmsPackageLotTranfer"
    ) {
        var hhdvFile = new SCFile("esdMSkmsHHDV");
        try {
            var query = "";
            if (category == "HD_KMS" || category == "HD_KMS_TTMS") {
                query =
                    'kms.package.id="' + packageId + '" and current.phase="Theo doi"';
            } else {
                query = 'lot.id="' + packageId + '" and current.phase="Theo doi"';
                var rc = hhdvFile.doSelect(query);
                if (rc !== RC_SUCCESS) {
                    query =
                        'kms.package.id="' + packageId + '" and current.phase="Theo doi"';
                }
            }
            var rc = hhdvFile.doSelect(query);
            while (rc === RC_SUCCESS) {
                result.push(mappingHHDVData(hhdvFile));
                rc = hhdvFile.getNext();
            }
        } finally {
            hhdvFile.doClose();
        }
        return result;
    }

    // =====================================================
    // Dữ liệu transfer
    // =====================================================

    var hhdvTranferFile = new SCFile("esdMSkmsHHDVTranfer");
    try {
        var transferQuery = "";
        if (packageIdOrigin === "esdMSkmsPackagesTranfer") {
            transferQuery = 'kms.package.id="' + packageId + '"';
        } else {
            transferQuery = 'lot.id="' + packageId + '"';
        }
        var rc = hhdvTranferFile.doSelect(transferQuery);
        while (rc === RC_SUCCESS) {
            result.push(mappingHHDVData(hhdvTranferFile));
            rc = hhdvTranferFile.getNext();
        }
    } catch (e) {
        print("Lỗi lấy HHDV transfer: " + e.message);
    } finally {
        hhdvTranferFile.doClose();
    }
    return result;
}

/**
 * Lấy danh sách Hàng hóa dịch vụ (HHDV) chờ mua dựa vào Đề xuất mua sắm
 * @param {string} createdBy - ID người dùng được phân công (initData.createdBy)
 * @returns {Array} Mảng object các bản ghi HHDV
 */
// function getHangHoaChoMuaDXMS(payload) {
//   var result = [];
//   var createdBy = payload.createdBy;
//   try {
//     // 1. Lấy danh sách dxms.id từ bảng esdMSdxmsItemAssignment
//     var dxmsIds = [];
//     var assignFile = new SCFile("esdMSdxmsItemAssignment");
//     var assignQuery = 'assignee.id="' + createdBy + '" and status="Da tiep nhan"';
//     var rcAssign = assignFile.doSelect(assignQuery);

//     while (rcAssign == RC_SUCCESS) {
//       var dxmsId = assignFile["dxms.id"];
//       // Tránh trùng lặp dxms.id
//       if (dxmsId && dxmsIds.indexOf(dxmsId) === -1) {
//         dxmsIds.push(dxmsId);
//       }
//       rcAssign = assignFile.getNext();
//     }

//     if (dxmsIds.length === 0) {
//       return result;
//     }

//     // 2. Lấy tất cả HHDV thuộc các dxms.id đã tìm được từ bảng esdMSdxmsItem
//     var itemFile = new SCFile("esdMSdxmsItem");
//     // Xây dựng câu query dạng isin {"id1", "id2"} chuẩn của Service Manager
//     var dxmsIdString = '"' + dxmsIds.join('","') + '"';
//     var itemQuery = 'dxms.id isin {' + dxmsIdString + '}';

//     var rcItem = itemFile.doSelect(itemQuery);
//     while (rcItem == RC_SUCCESS) {
//       result.push({

//         id: itemFile["id"],
//         itemId:itemFile["item.id"],
//         dxmsId: itemFile["dxms.id"],
//         itemCode: itemFile["item.code"],
//         itemName: itemFile["item.name"],
//         quantityRequest: itemFile["quantity.request"],
//         unitPrice: itemFile["unit.price"],
//         currencyRate: itemFile["currency.rate"],
//         deliveryTime: itemFile["delivery.time"],
//         deliveryUnit: itemFile["delivery.unit"],
//         priorityLevel: itemFile["priority.level"],
//         fundSource: itemFile["fund.source"]
//       });
//       rcItem = itemFile.getNext();
//     }
//   } catch (err) {
//     print("[ESD_HD_ACTION_WF.getHangHoaChoMuaDXMS] Error: " + err);
//   }
//   return result;
// }

function calculateTTMSHHDVTotal(record) {
    var result = {
        success: false,
        message: "",
        totalContractValue: 0
    };

    try {
        var hhdvList =
            layHHDVTheoGoiThau(record["item.id"], record["category"]) || [];

        var totalContractValue = 0;

        for (var i = 0; i < hhdvList.length; i++) {
            var currentItem = hhdvList[i];

            var payload = {
                quantity: currentItem.quantity || "",
                "unit.price": String(currentItem.unitPrice || 0),
                "money.tax.other": currentItem.taxOther || "",
                "vat.id": String(currentItem.taxVatRate || 0)
            };

            var resultVat = lib.ESD_HD_COMMON.calculateAmount(payload);

            var amountBeforeTax = Number(resultVat.amountBeforTax) || 0;

            var moneyTax = Number(resultVat.moneyTax) || 0;

            var rowTotal =
                resultVat.amountAfterTax !== null &&
                resultVat.amountAfterTax !== undefined &&
                resultVat.amountAfterTax !== "" ?
                Number(resultVat.amountAfterTax) || 0 :
                amountBeforeTax + moneyTax;

            totalContractValue += rowTotal;
        }

        result.totalContractValue = totalContractValue;
        result.success = true;
    } catch (err) {
        result.message = err.message || String(err);
    }

    return result;
}

// update number inspection
function updateInspectionAndContract(record) {
    if (!record || !record["id"]) {
        print("[updateInspectionAndContract] Record hoặc id không hợp lệ");
        return;
    }

    const toFloat = lib.ESD_Utils.toFloat;
    const roundMath = lib.ESD_Utils.roundMath;
    const formatMoneyView = lib.ESD_Utils.formatCurrency;

    var ntclktId = record["id"];
    const activityTable = "activityHDcontractHHDV";
    const type = "Cập nhật";
    var fHhdv = new SCFile("esdHDacceptanceHHDV");
    var totalAmountAfterTaxConvert = 0;

    try {
        var rc = fHhdv.doSelect(`ntclkt.id="${ntclktId}"`);

        while (rc == RC_SUCCESS) {
            var contractHhdvId = fHhdv["contract.hhdv.id"];
            var totalPass = Number(fHhdv["total.pass"]) || 0;

            // =========================
            // Update esdHDcontractHHDV
            // =========================
            if (contractHhdvId) {
                var fContract = new SCFile("esdHDcontractHHDV");
                try {
                    var rcContract = fContract.doSelect(
                        `id="${contractHhdvId}" AND category <> "HD_PO"`
                    );

                    // Chỉ khi tìm thấy contract
                    if (rcContract == RC_SUCCESS) {
                        if (fContract.reference == "giaTri") {
                            const giaTri = lib.ESD_HD_COMMON.calculateAmountGiaTri(fHhdv);

                            let acceptedTechnicalValue =
                                toFloat(fContract["accepted.technical.value"]) || 0; //Giá trị đã nghiệm thu CLKT
                            let pendingAcceptanceValue =
                                toFloat(fContract["pending.acceptance.value"]) || 0; //Giá trị chưa nghiệm thu CLKT

                            fContract["accepted.technical.value"] =
                                acceptedTechnicalValue + toFloat(giaTri.amountAfterTaxConvert);
                            fContract["pending.acceptance.value"] =
                                pendingAcceptanceValue - toFloat(giaTri.amountAfterTaxConvert);
                            fContract.doUpdate();

                            createActivity(
                                activityTable,
                                `Biên bản NTCLKT ${ntclktId} thay đổi giá trị nghiệm thu CLKT: ${formatMoneyView(roundMath(acceptedTechnicalValue, 2))} → ${formatMoneyView(roundMath(acceptedTechnicalValue + toFloat(giaTri.amountAfterTaxConvert), 2))}`,
                                contractHhdvId,
                                type
                            );
                            createActivity(
                                activityTable,
                                `Biên bản NTCLKT ${ntclktId} thay đổi giá trị chưa nghiệm thu CLKT: ${formatMoneyView(roundMath(pendingAcceptanceValue, 2))} → ${formatMoneyView(roundMath(pendingAcceptanceValue - toFloat(giaTri.amountAfterTaxConvert), 2))}`,
                                contractHhdvId,
                                type
                            );

                            totalAmountAfterTaxConvert += toFloat(
                                giaTri.amountAfterTaxConvert
                            );
                        } else {
                            //Cập nhật phần tính giá trị
                            fHhdv["quantity"] = fHhdv["total.pass"];
                            const soLuong = lib.ESD_HD_COMMON.calculateAmount(fHhdv);

                            let acceptedTechnicalValue =
                                toFloat(fContract["accepted.technical.value"]) || 0; //Giá trị đã nghiệm thu CLKT
                            let pendingAcceptanceValue =
                                toFloat(fContract["pending.acceptance.value"]) || 0; //Giá trị chưa nghiệm thu CLKT

                            fContract["accepted.technical.value"] =
                                acceptedTechnicalValue + toFloat(soLuong.amountAfterTaxConvert);
                            fContract["pending.acceptance.value"] =
                                pendingAcceptanceValue - toFloat(soLuong.amountAfterTaxConvert);

                            //Phần tính số lượng
                            var acceptedQty =
                                Number(fContract["accepted.technical.quantity"]) || 0;

                            var contractQty = Number(fContract["quantity"]) || 0;

                            var newAcceptedQty = acceptedQty + totalPass;

                            fContract["accepted.technical.quantity"] = newAcceptedQty;

                            fContract["pending.acceptance.quantity"] =
                                contractQty - newAcceptedQty;

                            fContract.doUpdate();
                            createActivity(
                                activityTable,
                                `Biên bản NTCLKT ${ntclktId} thay đổi Số lượng nghiệm thu CLKT: ${acceptedQty} → ${newAcceptedQty}`,
                                contractHhdvId,
                                type
                            );
                            createActivity(
                                activityTable,
                                `Biên bản NTCLKT ${ntclktId} thay đổi Số lượng chưa nghiệm thu CLKT: ${contractQty} → ${contractQty - newAcceptedQty}`,
                                contractHhdvId,
                                type
                            );
                            createActivity(
                                activityTable,
                                `Biên bản NTCLKT ${ntclktId} thay đổi giá trị nghiệm thu CLKT: ${acceptedTechnicalValue} → ${acceptedTechnicalValue + toFloat(soLuong.amountAfterTaxConvert)}`,
                                contractHhdvId,
                                type
                            );
                            createActivity(
                                activityTable,
                                `Biên bản NTCLKT ${ntclktId} thay đổi giá trị chưa nghiệm thu CLKT: ${pendingAcceptanceValue} → ${pendingAcceptanceValue - toFloat(soLuong.amountAfterTaxConvert)}`,
                                contractHhdvId,
                                type
                            );

                            // =========================
                            // Tính amountAfterTaxConvert cho từng HHDV
                            // =========================

                            var calcResult =
                                lib.ESD_HD_COMMON.calcMoneyWithRateOfNumberAcceptanceAndTotalConvert(
                                    fHhdv
                                );
                            totalAmountAfterTaxConvert += calcResult.amountAfterTaxConvert;
                        }
                    }
                } finally {
                    fContract.doClose();
                }
            }

            rc = fHhdv.getNext();
        }
    } finally {
        fHhdv.doClose();
    }
}

// Update Số lượng đã nhận bàn giao, chưa nhận bàn giao
// Và cập nhật số lượng nghiệm thu CLKT nếu inspection.type = out
function updateSoLuongBanGiaoHopDongPO(record, isUpdateContractTask = true) {
    if (!record || !record["id"]) {
        print("[updateSoLuongBanGiaoHopDong] Record hoặc id không hợp lệ");
        return;
    }
    const roundMath = lib.ESD_Utils.roundMath;
    const formatMoneyView = lib.ESD_Utils.formatCurrency;

    var ntbgId = record["id"];

    // =====================================
    // Lấy inspection.type của biên bản NTBG
    // =====================================
    var inspectionType = "";
    var activityTable = "activityHDcontractHHDV";
    var type = "Cập nhật";
    var fNTBG = new SCFile("esdHDhandover");
    let reportName = "";

    try {
        if (fNTBG.doSelect(`id="${ntbgId}"`) == RC_SUCCESS) {
            inspectionType = fNTBG["inspection.type"] || "";
            let category = fNTBG["category"] || "";
            if (category == "BGHHDV") {
                reportName = "Biên bản NTBG";
            } else if (category == "TKHHDV") {
                reportName = "Biên bản YCTK";
            }
        }
    } finally {
        if (fNTBG) {
            fNTBG.doClose();
        }
    }
    // =====================================
    // Duyệt danh sách HHDV của biên bản
    // =====================================
    var fHhdv = new SCFile("esdHDhandoverHHDV");

    try {
        var rc = fHhdv.doSelect(`ntbg.id="${ntbgId}"`);

        while (rc == RC_SUCCESS) {
            var contractHhdvId = fHhdv["contract.hhdv.id"];
            var acceptedHandoverQty =
                Number(fHhdv["accepted.handover.quantity"]) || 0;
            if (contractHhdvId) {
                var fContract = new SCFile("esdHDcontractHHDV");
                try {
                    var rcContract = fContract.doSelect(
                        `id="${contractHhdvId}" AND category <> "HD_PO"`
                    );

                    if (rcContract == RC_SUCCESS) {
                        let acceptedTechnicalValue =
                            toFloat(fContract["accepted.technical.value"]) || 0; //Giá trị đã nghiệm thu CLKT
                        let pendingAcceptanceValue =
                            toFloat(fContract["pending.acceptance.value"]) || 0; //Giá trị chưa nghiệm thu CLKT
                        let receivedHandoverValue =
                            toFloat(fContract["received.handover.value"]) || 0; //Giá trị đã nhận bàn giao
                        let pendingHandoverValue =
                            toFloat(fContract["pending.handover.value"]) || 0; //Giá trị chưa nhận bàn giao

                        let giaTri = null;
                        if (fContract.reference == "giaTri") {
                            giaTri = lib.ESD_HD_COMMON.calculateAmountHHDVGiaTri(fHhdv);
                        } else giaTri = lib.ESD_HD_COMMON.calculateAmountBGHHDV(fHhdv);
                        const amountTotalAmountConvert = giaTri.amountAfterTaxConvertHHDV; //Thành tiền sau thuế quy đổi

                        //Trong hệ thống NTCLKT
                        //Tăng số tiền đã bàn giao
                        fContract["received.handover.value"] =
                            receivedHandoverValue + amountTotalAmountConvert;
                        //Giảm số tiền chưa bàn giao
                        fContract["pending.handover.value"] =
                            pendingHandoverValue - amountTotalAmountConvert;

                        //Cập nhật lịch sử
                        let text = `${reportName} ${ntbgId} thay đổi giá trị đã nhận bàn giao: ${formatMoneyView(roundMath(receivedHandoverValue, 2))} → ${formatMoneyView(roundMath(fContract["received.handover.value"], 2))}`;
                        createActivity(activityTable, text, contractHhdvId, type);
                        text = `${reportName} ${ntbgId} thay đổi giá trị chưa nhận bàn giao: ${formatMoneyView(roundMath(pendingHandoverValue, 2))} → ${formatMoneyView(roundMath(fContract["pending.handover.value"], 2))}`;
                        createActivity(activityTable, text, contractHhdvId, type);

                        var contractQty = Number(fContract["quantity"]) || 0;
                        // =========================
                        // Số lượng đã nhận bàn giao
                        // =========================
                        var receivedHandoverQty =
                            Number(fContract["received.handover.quantity"]) || 0;

                        var newReceivedHandoverQty =
                            receivedHandoverQty + acceptedHandoverQty;

                        fContract["received.handover.quantity"] = newReceivedHandoverQty;

                        fContract["pending.handover.quantity"] =
                            contractQty - newReceivedHandoverQty;
                        createActivity(
                            activityTable,
                            `${reportName} ${ntbgId} thay đổi Số lượng nhận bàn giao: ${receivedHandoverQty} → ${newReceivedHandoverQty}`,
                            contractHhdvId,
                            type
                        );
                        createActivity(
                            activityTable,
                            `${reportName} ${ntbgId} thay đổi Số lượng chưa nhận bàn giao: ${contractQty} → ${contractQty - newReceivedHandoverQty}`,
                            contractHhdvId,
                            type
                        );
                        // =========================
                        // Nếu NTBG loại đính kèm thông tin ngoài hệ thống
                        // =========================
                        if (inspectionType == "out") {
                            //Ngoài hệ thống NTCLKT (Vì đã nghiệm thu ở ngoài rồi nhưng k cho lên hệ thống)
                            //Tăng giá trị đã nghiệm thu CLKT
                            fContract["accepted.technical.value"] =
                                acceptedTechnicalValue + amountTotalAmountConvert;
                            //Giảm giá trị chưa nghiệm thu CLKT
                            fContract["pending.acceptance.value"] =
                                pendingAcceptanceValue - amountTotalAmountConvert;

                            //Cập nhật lịch sử
                            text = `${reportName} ${ntbgId} thay đổi giá trị đã nghiệm thu CLKT: ${formatMoneyView(roundMath(acceptedTechnicalValue, 2))} → ${formatMoneyView(roundMath(fContract["accepted.technical.value"], 2))}`;
                            createActivity(activityTable, text, contractHhdvId, type);

                            text = `${reportName} ${ntbgId} thay đổi giá trị chưa nghiệm thu CLKT: ${formatMoneyView(roundMath(pendingAcceptanceValue, 2))} → ${formatMoneyView(roundMath(fContract["pending.acceptance.value"], 2))}`;
                            createActivity(activityTable, text, contractHhdvId, type);

                            if (fContract.reference != "giaTri") {
                                //Xử lý update số lượng
                                var acceptedTechnicalQty =
                                    Number(fContract["accepted.technical.quantity"]) || 0;
                                var newAcceptedTechnicalQty =
                                    acceptedTechnicalQty + acceptedHandoverQty;

                                fContract["accepted.technical.quantity"] =
                                    newAcceptedTechnicalQty;

                                fContract["pending.acceptance.quantity"] =
                                    contractQty - newAcceptedTechnicalQty;
                                createActivity(
                                    activityTable,
                                    `${reportName} ${ntbgId} thay đổi Số lượng nghiệm thu CLKT: ${acceptedTechnicalQty} → ${newAcceptedTechnicalQty}`,
                                    contractHhdvId,
                                    type
                                );
                                createActivity(
                                    activityTable,
                                    `${reportName} ${ntbgId} thay đổi Số lượng chưa nghiệm thu CLKT: ${contractQty} → ${contractQty - newAcceptedTechnicalQty}`,
                                    contractHhdvId,
                                    type
                                );
                            }
                        }
                        fContract.doUpdate();
                    }
                } finally {
                    if (fContract) {
                        fContract.doClose();
                    }
                }
            }
            rc = fHhdv.getNext();
        }
    } finally {
        if (fHhdv) {
            fHhdv.doClose();
        }
    }
}

function updateHHDVFromPO(record) {
    var result = {
        success: false,
        message: "",
        updated: 0
    };

    if (!record || !record["id"] || !record["item.id"]) {
        result.message = "Thiếu ID PO hoặc ID hợp đồng gốc.";
        return result;
    }

    var poId = record["id"];
    var contractId = record["item.id"];

    var fPO = null;
    var fHhdvPO = null;
    var fHhdvOriginal = null;

    try {
        // =====================================
        // 1. Kiểm tra PO đầu tiên hoàn thành
        // =====================================
        var completedCount = 0;

        fPO = new SCFile("esdHDcontract");

        var completedCount = 0;
        var currentPOCounted = false;

        var rcPO = fPO.doSelect(
            'item.id="' + contractId +
            '" AND category="HD_PO" AND status="Hoan thanh"'
        );

        while (rcPO == RC_SUCCESS) {
            completedCount++;

            if (fPO["id"] == poId) {
                currentPOCounted = true;
            }

            rcPO = fPO.getNext();
        }

        // PO hiện tại chưa được lưu trạng thái hoàn thành xuống DB
        if (!currentPOCounted) {
            completedCount++;
        }

        var isFirstCompletedPO = completedCount == 1;

        // =====================================
        // 2. Lấy HHDV thuộc PO hiện tại
        // =====================================
        fHhdvPO = new SCFile("esdHDcontractHHDV");

        var rcHhdv = fHhdvPO.doSelect(
            'contract.id="' + poId + '" AND category="HD_PO"'
        );

        while (rcHhdv == RC_SUCCESS) {
            var originalHhdvId = fHhdvPO["hhdv.id"];

            if (originalHhdvId) {
                fHhdvOriginal = new SCFile("esdHDcontractHHDV");

                try {
                    var rcOriginal = fHhdvOriginal.doSelect(
                        'id="' + originalHhdvId + '"'
                    );

                    if (rcOriginal == RC_SUCCESS) {
                        var reference = fHhdvOriginal["reference"];

                        var fields = [
                            "pending.handover.value",
                            "received.handover.value"
                        ];

                        if (reference == "soLuong") {
                            fields = [
                                "accepted.technical.quantity",
                                "pending.acceptance.quantity",
                                "pending.handover.quantity",
                                "pending.handover.value",
                                "received.handover.quantity",
                                "received.handover.value"
                            ];
                        }

                        // =====================================
                        // 3. Replace hoặc cộng dồn
                        // =====================================
                        for (var i = 0; i < fields.length; i++) {
                            var fieldName = fields[i];

                            var poValue =
                                Number(fHhdvPO[fieldName]) || 0;

                            var originalValue =
                                Number(fHhdvOriginal[fieldName]) || 0;

                            fHhdvOriginal[fieldName] =
                                isFirstCompletedPO ?
                                poValue :
                                originalValue + poValue;
                        }

                        var updateRc = fHhdvOriginal.doUpdate();

                        if (updateRc != RC_SUCCESS) {
                            result.message =
                                "Không thể cập nhật HHDV gốc: " +
                                originalHhdvId +
                                ". RC = " + updateRc;
                            return result;
                        }

                        result.updated++;
                    } else {
                        result.message =
                            "Không tìm thấy HHDV gốc: " + originalHhdvId;
                        return result;
                    }
                } finally {
                    fHhdvOriginal.doClose();
                    fHhdvOriginal = null;
                }
            }

            rcHhdv = fHhdvPO.getNext();
        }

        result.success = true;
        result.message =
            "Cập nhật HHDV hợp đồng gốc thành công. Số HHDV: " +
            result.updated;

        return result;

    } catch (e) {
        result.message = "Lỗi cập nhật HHDV từ PO: " + (e.message || e);
        return result;
    } finally {
        if (fPO) fPO.doClose();
        if (fHhdvPO) fHhdvPO.doClose();
        if (fHhdvOriginal) fHhdvOriginal.doClose();
    }
}