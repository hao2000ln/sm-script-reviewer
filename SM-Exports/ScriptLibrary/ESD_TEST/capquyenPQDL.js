var unitIds=[];
if(record['user.lv1.id']){
    unitIds.push(record['user.lv1.id']);
}
if (record['user.lv2.id']) {
    unitIds.push(record['user.lv2.id']);
}
if (record['user.lv3.id']) {
    unitIds.push(record['user.lv3.id']);
}

var submoduleid = "00101";
var contactId = [record["created.by"]];
function getApprovers(rightsIds) {
    var contactIds = lib.ESD_PERMS_RIGHTS.getContactsByRightsAndUnits(rightsIds,submoduleid,unitIds,contactId);
    if (!contactIds || contactIds.length === 0) {
        return {contactIds: [],fullNames: []};
    }
    var query = lib.ESD_PERMS_RIGHTS.orList("contact.name", contactIds);
    return lib.ESD_PERMS_RIGHTS.getContacts(query);
}

var approversLv3 = getApprovers(["0010010001000001"]);
var approversLv2 = getApprovers(["0010010001000002"]);

function getCreatorOrgUnit() {
    var lv1Id = record["user.lv1.id"] || "";
    if (!lv1Id) {
        return "";
    }
    var orgUnit = new SCFile("esdQTorgUnit", SCFILE_READONLY);
    var rc = orgUnit.doSelect(`unit.id="${lv1Id}"`);
    return rc === RC_SUCCESS ? (orgUnit["org.unit"] || "") : "";
}

// CB hoàn tất: TSC dùng QT003; đơn vị ngoài TSC dùng QT004.
var creatorOrgUnit = getCreatorOrgUnit();
var approversComplete = creatorOrgUnit === "TSC"
    ? getApprovers(["0010010001000003"])
    : getApprovers(["0010010001000004"]);



//set biến
// Lãnh đạo xác nhận cấp Phòng ban thuộc Trung tâm — QT001
vars['$lanhdao.pbthuoctt'] = approversLv3.contactIds;
vars['$lanhdao.pbthuoctt.view'] = approversLv3.fullNames;

// Lãnh đạo xác nhận cấp Phòng ban/Trung tâm — QT002
vars['$lanhdao.pbtt'] = approversLv2.contactIds;
vars['$lanhdao.pbtt.view'] = approversLv2.fullNames;

// CB xác nhận và hoàn tất phân quyền — QT003 (TSC) hoặc QT004 (ngoài TSC)
vars['$canbo.xacnhan'] = approversComplete.contactIds;
vars['$canbo.xacnhan.view'] = approversComplete.fullNames;


if(record['user.lv3.id']){
    if(approversLv3.contactIds.length > 0){
        // record.status = "Cho phe duyet cap PB thuoc TT";
    }else{
        if(approversLv2.contactIds.length > 0){
            // record.status = "Cho phe duyet cap PBTT";
        }else{
            lib.ESD_Utils.printMsg("Không tìm thấy cán bộ thực hiện phê duyệt phiếu!", 3);
            returnCode = 1;
        }
    }
}else{
    if(approversLv2.contactIds.length > 0){
        // record.status = "Cho phe duyet cap PBTT";
    }else{
        lib.ESD_Utils.printMsg("Không tìm thấy cán bộ thực hiện phê duyệt phiếu!", 3);
        returnCode = 1;
    }
}

// (index("0010010001000003", $G.rights)>0 and jscall("ESD_KH_Utils.getFieldName", "esdQTorgUnit", "unit.id", $G.contacts.lv1, "org.unit")= "TSC") 
// or 
// (index("0010010001000004", $G.rights)>0 and jscall("ESD_KH_Utils.getFieldName", "esdQTorgUnit", "unit.id", $G.contacts.lv1, "org.unit")~= "TSC")
