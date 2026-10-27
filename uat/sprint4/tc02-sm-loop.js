/**
 * Read contact records.
 */
function loadContacts() {
    var file = new SCFile("contacts");
    var rc = file.doSelect('true');

    while (rc == RC_SUCCESS) {
        print(file.contact_name);
    }

    return rc;
}