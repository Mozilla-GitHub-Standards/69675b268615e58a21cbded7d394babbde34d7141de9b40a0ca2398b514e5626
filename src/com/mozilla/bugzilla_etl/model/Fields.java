/* -*- Mode: java; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 *
 * ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is mozilla.org code.
 *
 * The Initial Developer of the Original Code is
 * Mozilla Corporation.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Michael Kurze (michael@thefoundation.de)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK *****
 */

package com.mozilla.bugzilla_etl.model;


/**
 * This collects all fields we are dealing with in a central place.
 * <ul>
 * <li>Not all of the fields are necessarily used in the warehouse.</li>
 * <li>Not all of the fields necessarily occur as columns in bugzilla.</li>
 * </ul>
 */
public class Fields {

    /**
     * Fields that provide (meta) data about an activity. These also serve as
     * facets in the index.
     * All of them come directly from the activities table in Bugzilla.
     */
    public static enum Activity implements Field {
        ENTITY_ID("activity_entity_id"),
        MODIFIED_BY,
        MODIFICATION_DATE,
        EXPIRATION_DATE,
        ANNOTATION,
        PERSISTENCE_STATE;

        public String columnName;

        @Override
        public String columnName() { return columnName; }

        @Override
        public Family family() { return Family.ACTIVITY; }

        Activity(String name) { columnName = name; }
        Activity() { columnName = name().toLowerCase(); }
    }

    public static enum Column { LATEST, FROM, TO, RESULT }

 }
