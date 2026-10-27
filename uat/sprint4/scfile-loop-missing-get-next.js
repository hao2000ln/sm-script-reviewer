/** Process contacts without advancing the query cursor. */
function processContacts() {
    var file = new SCFile("contacts");
    var rc = file.doSelect('true');
    while (rc == RC_SUCCESS) {
        processContact(file);
    }
    return rc;
}
