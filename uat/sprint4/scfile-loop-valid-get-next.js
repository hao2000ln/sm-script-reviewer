/** Process contacts and advance the query cursor. */
function processContacts() {
    var file = new SCFile("contacts");
    var rc = file.doSelect('true');
    while (rc == RC_SUCCESS) {
        processContact(file);
        rc = file.getNext();
    }
    return rc;
}
