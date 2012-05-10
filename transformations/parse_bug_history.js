/* Workflow:
Create the current state object

For each row containing latest state data (fields from bugs table record, fields from other tables (i.e. attachments, dependencies)
    Update the current state object with the latest field values

Walk backward through activity records from bugs_activity (and other activity type tables). For each set of activities:
    Create a new bug version object with the meta data about this activity
        Set id based on modification time
*       Set valid_from field as modification time
*       Set valid_to field as the modification time of the later version - 1 second
        Add modification data (who, when, what)
    For single value fields (i.e. assigned_to, status):
        Update the original state object by replacing the field value with the contents of the activities "removed" column
    For multi-value fields (i.e. blocks, CC, attachments):
        If a deletion, update the original state object by adding the value from the "removed" column to the field values array.
        If an addition, find and remove the added item from the original state object

When finished with all activities, the current state object should reflect the original state of the bug when created.
Now, build the full state of each intermediate version of the bug. 

For each bug version object that was created above:
    Merge the current state object into this version object
    Update fields according to the modification data

*/

var currBugID;
var prevBugID;
var bugVersions;
var bugVersionsMap;
var currBugState;
var currBugAttachments;
var currBugAttachmentsMap;
var prevActivityID;
var currActivity;
var inputRowSize = getInputRowMeta().size();
var outputRowSize = getOutputRowMeta().size();

function processRow(bug_id, modified_ts, modified_by, field_name, field_value, field_value_removed, attach_id, _merge_order) {
    currBugID = bug_id;

    writeToLog("e", "bug_id={" + bug_id + "}, modified_ts={" + modified_ts + "}, modified_by={" + modified_by 
          + "}, field_name={" + field_name + "}, field_value={" + field_value + "}, field_value_removed={"
          + field_value_removed + "}, attach_id={" + attach_id + "}, _merge_order={" + _merge_order + "}");

    // If we have switched to a new bug
    if (prevBugID < currBugID) {
        // Start replaying versions in ascending order to build full data on each version
        populateIntermediateVersionObjects();
        startNewBug(bug_id, modified_ts, modified_by, _merge_order);
    }


    if (currBugID < 999999999) {
        // Determine where we are in the bug processing workflow
        switch (_merge_order) {
            case 1:
                processSingleValueTableItem(field_name, field_value);
                break;
            case 2:
                processMultiValueTableItem(field_name, field_value);
                break;
            case 7:
                processAttachmentsTableItem(modified_ts, modified_by, field_name, field_value, field_value_removed, attach_id);
                break;
            case 8:
                processFlagsTableItem(modified_ts, modified_by, field_name, field_value, field_value_removed, attach_id);
                break;
            case 9:
                processBugsActivitiesTableItem(modified_ts, modified_by, field_name, field_value, field_value_removed, attach_id);
                break;
            default:
                break;
        }

        //return [currBugState,currActivity];
    }
}

function startNewBug(bug_id, modified_ts, modified_by, _merge_order) {
    if (currBugID >= 999999999) return;
    if (_merge_order != 1) {
        writeToLog("e", "Current bugs table record not found for bug_id: "+bug_id);
    }
    prevBugID = bug_id;
    bugVersions = [];
    bugVersionsMap = {};
    currBugState = {
        bug_id: bug_id,
        modified_ts: modified_ts,
        modified_by: modified_by,
        reported_by: modified_by,
        attachments: [],
        flags: []
    };
    currBugState._id = bug_id+"."+modified_ts;
    currActivity = {};
    currBugAttachments = [];
    currBugAttachmentsMap = {};
}

function processSingleValueTableItem(field_name, field_value) {
    currBugState[field_name] = field_value;
}

function processMultiValueTableItem(field_name, field_value) {
    //writeToLog("e", "About to push "+field_value+" to array field "+field_name+" on bug "
    //    +currBugID+" current value:"+JSON.stringify(currBugState[field_name]));
    if (currBugState[field_name] == null) {
        currBugState[field_name] = [];
    }
    try {
        currBugState[field_name].push(field_value);
    } catch(e) {
        writeToLog("e", "Unable to push "+field_value+" to array field "+field_name+" on bug "
              +currBugID+" current value:"+JSON.stringify(currBugState[field_name]));
    }
}

function processAttachmentsTableItem(modified_ts, modified_by, field_name, field_value, field_value_removed, attach_id) {
    currActivityID = currBugID+"."+modified_ts;
    if (currActivityID != prevActivityID) {
        currActivity = {
            _id: currActivityID,
            modified_ts: modified_ts,
            modified_by: modified_by,
            changes: []
        };
        bugVersions.push(currActivity);
        bugVersionsMap[currActivityID] = currActivity;
        prevActivityID = currActivityID;
    }
    currActivity.changes.push({
        field_name: field_name,
        field_value: field_value,
        attach_id: attach_id
    });
    if (!currBugAttachmentsMap[attach_id]) {
        currBugAttachmentsMap[attach_id] = {
            _id: attach_id+"."+modified_ts,
            attach_id: attach_id,
            modified_ts: modified_ts,
            modified_by: modified_by,
            flags: []
        };
        currBugAttachments.push(currBugAttachmentsMap[attach_id]);
    }
    currBugAttachmentsMap[attach_id][field_name] = field_value;
}

function processFlagsTableItem(modified_ts, modified_by, field_name, field_value, field_value_removed, attach_id) {
//    var parts = splitFlag(field_value);
    var flag = {
        modified_ts: modified_ts,
        modified_by: modified_by,
        field_name: field_value
//        field_value: parts[1]
    };
    if (attach_id != '') {
        if (!currBugAttachmentsMap[attach_id]) {
            writeToLog("e", "Unable to find attachment "+attach_id+" for bug_id "+currBugID);
        }
        currBugAttachmentsMap[attach_id].flags.push(flag);
    } else {
        currBugState.flags.push(flag);
    }
}

function processBugsActivitiesTableItem(modified_ts, modified_by, field_name, field_value, field_value_removed, attach_id) {
    if (field_name == "flagtypes.name") {
        field_name = "flags";
    }

    var multi_field_value = getMultiFieldValue(field_name, field_value);
    var multi_field_value_removed = getMultiFieldValue(field_name, field_value_removed);

    currActivityID = currBugID+"."+modified_ts;
    if (currActivityID != prevActivityID) {
        currActivity = bugVersionsMap[currActivityID];
        if (!currActivity) {
            currActivity = {
                _id: currActivityID,
                modified_ts: modified_ts,
                modified_by: modified_by,
                changes: []
            };
            bugVersions.push(currActivity);
        }
        prevActivityID = currActivityID;
    }
    currActivity.changes.push({
        field_name: field_name,
        field_value: field_value,
        field_value_removed: field_value_removed,
        attach_id: attach_id
    });
    if (attach_id != '') {
        var attachment = currBugAttachmentsMap[attach_id];
        if (!attachment) {
            writeToLog("e", "Unable to find attachment "+attach_id+" for bug_id "+currBugID+": "+JSON.stringify(currBugAttachmentsMap));
        }
        if (attachment[field_name] instanceof Array) {
            var a = attachment[field_name];
            if (multi_field_value_removed[0] == '') {
                removeValues(a, multi_field_value, "added", field_name, "attachment", attachment);
            } else {
                a = a.concat(multi_field_value_removed);
            }
        } else {
            attachment[field_name] = field_value_removed;
        }
    } else {
        if (currBugState[field_name] instanceof Array) {
            var a = currBugState[field_name];
            if (multi_field_value_removed[0] == '') {
                removeValues(a, multi_field_value, "added", field_name, "currBugState", currBugState);
            } else {
                a = a.concat(field_value_removed);
            }
        } else if (isMultiField(field_name)) {
            // field must currently be missing, otherwise it would
            // be an instanceof Array above.  This handles multi-valued
            // fields that are not first processed by processMultiValueTableItem().
            currBugState[field_name] = [field_value_removed];
        } else {
            // Replace current value
            currBugState[field_name] = field_value_removed;
        }
    }
}

function sortAscByField(a, b, aField) {
    if (a[aField] > b[aField])
        return 1;
    if (a[aField] < b[aField])
        return -1;
    return 0;
}
function sortDescByField(a, b, aField) {
    return -1 * sortAscByField(a, b, aField);
}

function populateIntermediateVersionObjects() {
    // Make sure the bugVersions are in descending order by modification time.
    // They could be mixed because of attachment activity
    bugVersions.sort(function(a,b){return sortDescByField(a, b, "modified_ts")});

    var currVersion;
    // Prime the while loop with an empty next version so our first iteration outputs the initial bug state
    var nextVersion = {_id:currBugState._id,changes:[]};

    while (bugVersions.length > 0) {
        currVersion = nextVersion;
        nextVersion = bugVersions.pop(); // Oldest version
        writeToLog("d", "Populating JSON for version "+currVersion._id);

        // Link this version to the next one
        currBugState.expires_on = nextVersion.modified_ts;

        // Copy all attributes from the current version into currBugState
        for (var propName in currVersion) {
            currBugState[propName] = currVersion[propName];
        }

        // Attachments are already sorted.  No need to sort again.
        while (currBugAttachments[0] && currBugAttachments[0].created_ts <= currBugState.modified_ts) {
            writeToLog("d", "Adding attachment into version "+currBugState.modified_ts+": "+JSON.stringify(currBugAttachments[0]));
            currBugState.attachments.push(currBugAttachments.shift());
        }

        // Now walk currBugState forward in time by applying the changes from currVersion
        var changes = currVersion.changes;
        writeToLog("e", "Processing changes: "+JSON.stringify(changes));
        for (var changeIdx = 0; changeIdx < changes.length; changeIdx++) {
            var change = changes[changeIdx];
            // Special logic for multivalue fields
            if (currBugState[change.field_name] instanceof Array) {
                var a = currBugState[change.field_name];

                var multi_field_value = getMultiFieldValue(change.field_name, change.field_value);
                var multi_field_value_removed = getMultiFieldValue(change.field_name, change.field_value_removed);

                // This was a deletion, find and delete the value(s)
                if (multi_field_value_removed[0] != '') {
                    //removeValues(a, multi_field_value_removed, "removed", JSON.stringify(change), "activity", currBugState);
                   if (change["attach_id"] != '') {
                      removeAttachmentValues(currBugState["attachments"], multi_field_value_removed, change["attach_id"], change.field_name);
                   } else {
                      removeValues(a, multi_field_value_removed, "removed", change.field_name, "activity", currBugState);
                   }
                }

                // Handle addition (if any)
                for each (var added in multi_field_value) {
                    if (added != '') {
                        if (change.field_name == 'flags') {
                           var addedFlag = {
                                   "modified_ts": currVersion.modified_ts, 
                                   "modified_by": currVersion.modified_by, 
                                   "field_name": added
                               };
                           if (change["attach_id"] != '') {
                               // Attachment flag
                               appendAttachmentFlag(currBugState["attachments"], change["attach_id"], addedFlag);
                           } else {
                               // Bug flag
                               a.push(addedFlag);
                           }
                        } else {
                            a.push(added);
                        }
                    }
                }
            } else if (isMultiField(change.field_name)) {
                // First appearance of a multi-value field
                currBugState[change.field_name] = [change.field_value];
            } else {
                // Simple field change.
                currBugState[change.field_name] = change.field_value;
            }
        }

        // Do some processing to make sure that diffing betweens runs stays as similar as possible.
        stabilize(currBugState);

        // Emit this version as a JSON string
        var newRow = createRowCopy(outputRowSize);
        var rowIndex = inputRowSize;
        newRow[rowIndex++] = currBugState.bug_id;
        newRow[rowIndex++] = currBugState._id;
        newRow[rowIndex++] = JSON.stringify(currBugState,null,2);
        putRow(newRow);
    }
}

function stabilize(aBug) {
   if (aBug["cc"] && aBug["cc"][0]) {
      aBug["cc"].sort();
   }
}

function appendAttachmentFlag(attachments, attachId, addedFlag) {
   var found = false;
   for each (var a in attachments) {
      if (a.attach_id == attachId) {
         if (!a.flags)
            a.flags = [];

         a.flags.push(addedFlag);
         found = true;
         break;
      }
   }
   if (!found) {
       writeToLog("e", "Unable to find attachment with id '" + attachId + "' in " + JSON.stringify(attachments) + ".");
   }
}

function splitFlag(flag) {
    var parts = flag.split('(');
    if (parts.length == 2) {
        parts[1] = parts[1].slice(0,-1);
    }
    return parts;
}
function removeAttachmentValues(attachments, someValues, attachId, fieldName) {
   var foundAttId = false;
   for each (var a in attachments) {
      if (a.attach_id == attachId) {
         writeToLog("e", "Attempting to remove " + JSON.stringify(someValues) + " from field '" + fieldName + "' in " + JSON.stringify(a) + ".");
         if (fieldName == "flags") {
            var len = a[fieldName].length;
            for each (var v in someValues) {
               for (var i = 0; i < len; i++) {
                  if (a[fieldName][i].field_name == v) {
                     a[fieldName].splice(i, 1);
                     break;
                  }
               }
            }

            var missedValues = a[fieldName].length - (len - someValues.length);
            if (missedValues > 0) {
                writeToLog("e", "Failed to remove " + missedValues + " of " + someValues.length + " values.");
            }
         } else {
            for each (var v in someValues) {
                var foundAt = attachments[fieldName].indexOf(v);
                if (foundAt >= 0) {
                    anArray.splice(foundAt, 1);
                } else {
                    writeToLog("e", "Unable to find value " + fieldName + ":" + JSON.stringify(someValues)
                            + " in attachment: " + JSON.stringify(a));
                }
            }
         }
         
         foundAttId = true;
         break;
      }
   }
   if (!foundAttId) {
       writeToLog("e", "Unable to find attachment with id '" + attachId + "' in " + JSON.stringify(attachments) + ".");
   }
}

function removeValues(anArray, someValues, valueType, fieldName, arrayDesc, anObj) {
    if (fieldName == "flags") {
        for each (var v in someValues) {
            var len = anArray.length;
            for (var i = 0; i < len; i++) {
                // Match on flag name (incl. status) and flag value
                if (anArray[i].field_name == v) {
                     anArray.splice(i, 1);
                     break;
                }
            }

            if (len == anArray.length) {
                writeToLog("e", "Unable to find " + valueType + " flag " + fieldName + ":" + v
                        + " in " + arrayDesc + ": " + JSON.stringify(anObj));
            }
        }
    } else {
        for each (var v in someValues) {
            var foundAt = anArray.indexOf(v);
            if (foundAt >= 0) {
                anArray.splice(foundAt, 1);
            } else {
                // XXX if this is a "? 12345" type value for "dependson" etc, try looking for
                //     the value with the leading "? " trimmed off.
                writeToLog("e", "Unable to find " + valueType + " value " + fieldName + ":" + v
                        + " in " + arrayDesc + ": " + JSON.stringify(anObj));
            }
        }
    }
}

function isMultiField(aFieldName) {
    return (aFieldName == "flags" || aFieldName == "cc" || aFieldName == "keywords"
     || aFieldName == "dependson" || aFieldName == "blocked" || aFieldName == "dupe_by"
     || aFieldName == "dupe_of" || aFieldName == "bug_group");
}

function getMultiFieldValue(aFieldName, aFieldValue) {
    if (isMultiField(aFieldName)) {
        return aFieldValue.split(/\s*,\s*/);
    }

    return [aFieldValue];
}
