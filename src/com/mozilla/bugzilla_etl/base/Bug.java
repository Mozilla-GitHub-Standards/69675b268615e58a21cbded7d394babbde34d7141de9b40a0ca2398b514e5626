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

package com.mozilla.bugzilla_etl.base;

import java.util.Date;
import java.util.Iterator;
import java.util.LinkedList;
import java.util.ListIterator;
import java.util.Map;

import com.mozilla.bugzilla_etl.base.Fields.Facet;
import com.mozilla.bugzilla_etl.base.Fields.Measurement;

/** A bug with its invariant properties and all of its versions. */
public class Bug implements Iterable<Version> {

    public Bug(Long id, String reporter) {
        Assert.nonNull(id, reporter);
        this.id = id;
        this.reporter = reporter;
        versions = new LinkedList<Version>();
    }

    private static final long day = 24*60*60*1000;
    private boolean DEBUG_INCREMENTAL_UPDATE = true;
    private final Long id;
    private final String reporter;
    private final LinkedList<Version> versions;

    public Long id() { return id; }
    public String reporter() { return reporter; }
    public Iterator<Version> iterator() { return versions.iterator(); }
    public int numVersions() { return versions.size(); }

    public boolean equals(final Object object) {
        if (object == this) return true;
        if (object == null) return false;
        if (!(object instanceof Bug)) return false;
        Bug other = (Bug) object;
        if (!id.equals(other.id)) return false;
        if (!reporter.equals(other.reporter)) return false;
        if (versions.size() != other.versions.size()) return false;
        return versions.equals(other.versions);
    }

    /**
     * Steal all versions of the given bug and prepend them to this bug.
     * Both bugs must be for the same bugzilla bug id, the existing bug's versions should be
     * persistent.
     */
    public void baseUpon(final Bug existingBug) {
        Assert.check(id.equals(existingBug.id()));
        final LinkedList<Version> existingVersions = existingBug.versions;

        if (existingBug.versions.getLast().from().after(versions.getLast().from())) {
            System.out.format("Persistent version of bug #%d newer than version to import.\n", id);
        }

        // Tell me a ton about this so I can make sure it works
        if (DEBUG_INCREMENTAL_UPDATE) {
            System.out.format("[REBASE  ] %s\n     UPON  %s\n", this, existingBug);
            for (Version version : this) System.out.format("[NEW     ] %s\n", version);
            for (Version version : existingBug) System.out.format("[EXISTING] %s\n", version);
        }

        // Discard any versions we might have rebuilt locally that are also in the existing bug.
        // this can happen if an incremental update is run for a start time that was already
        // included in a (incremental) import.
        //
        final Version mostRecentExistingVersion = existingVersions.getLast();
        while (!versions.isEmpty() &&
               !versions.getFirst().from().after(mostRecentExistingVersion.from())) {
            if (DEBUG_INCREMENTAL_UPDATE) System.out.format("[.DELETE ] %s\n", versions.getFirst());
            versions.removeFirst();
        }

        ListIterator<Version> reverse = existingVersions.listIterator(existingVersions.size());
        boolean isMostRecent = true;
        while (reverse.hasPrevious()) {
            Version previous = reverse.previous();
            if (isMostRecent && !versions.isEmpty()) {
                previous = previous.update("", versions.getFirst().from());
            }
            isMostRecent = false;
            if (DEBUG_INCREMENTAL_UPDATE) System.out.format("[.PREPEND] %s\n", previous);
            prepend(previous);
        }

        if (DEBUG_INCREMENTAL_UPDATE) {
            for (Version version : this) System.out.format("[RESULT  ] %s\n", version);
        }
    }

    public void prepend(Version earlierVersion) {
        Assert.nonNull(earlierVersion);
        Assert.check(versions.isEmpty() || versions.peek().from().after(earlierVersion.to()));
        versions.addFirst(earlierVersion);
    }

    public void append(Version laterVersion) {
        Assert.nonNull(laterVersion);
        Assert.check(versions.isEmpty() || versions.getLast().to().before(laterVersion.from()));
        versions.addLast(laterVersion);
    }

    public boolean neverSaved() {
        return versions.getFirst().persistenceState() == PersistenceState.NEW;
    }

    public String toString() {
        final StringBuilder versionsVis = new StringBuilder(versions.size());
        for (final Version version : versions) {
            switch (version.persistenceState()) {
                case SAVED: versionsVis.append('.'); break;
                case DIRTY: versionsVis.append('#'); break;
                case NEW: versionsVis.append('*'); break;
                default: Assert.unreachable();
            }
        }
        return String.format("{bug id=%s, reporter=%s, versions=%s (.saved #dirty *new)}",
                             id, reporter, versionsVis.toString());
    }

    /**
     * Traverse the bug history from past to present and figure out what the value of individual
     * computed facets and measurements should be.
     *
     * Flags are changed from their incremental representation to their full representation.
     *
     * :TODO: Implement incremental update.
     * @param majorStatusTable A mapping from status names to major status names.
     */
    public void updateFacetsAndMeasurements(final Map<String, String> majorStatusTable,
                                            final Date now) {

        // First version will have -1 days for previous_status, previous_major_status
        long number = 1;

        // Latest version will have -1 days for status, major_status
        // and no change for days_open_accumulated
        boolean isLatest;

        String previousStatus = null;
        String previousMajorStatus = null;
        long msInStatus = 0;
        long msInMajorStatus = 0;
        long msOpenAccumulated = 0;
        int reopened = 0;

        for (Version version : this) {

            isLatest = version.to().after(now);

            final Map<Fields.Measurement, Long> measurements = version.measurements();
            final Map<Fields.Facet, String> facets = version.facets();
            final String status = facets.get(Facet.STATUS);
            final String majorStatus = majorStatusTable.get(status);

            long previousStatusDays = -1;
            long previousMajorStatusDays = -1;
            if (number > 1 && !status.equals(previousStatus)) {
                previousStatusDays = msInStatus/day;
                msInStatus = 0;
                if (!majorStatus.equals(previousMajorStatus)) {
                    if (Status.valueOf(status) == Status.REOPENED) ++reopened;
                    previousMajorStatusDays = msInMajorStatus/day;
                    msInMajorStatus = 0;
                }
            }

            final long duration = version.to().getTime() - version.from().getTime();
            msInStatus += duration;
            msInMajorStatus += duration;
            if (!isLatest && Status.Major.OPEN == Status.Major.valueOf(majorStatus)) {
                msOpenAccumulated += duration;
            }

            facets.put(Facet.MAJOR_STATUS, majorStatus);
            facets.put(Facet.PREVIOUS_STATUS, previousStatus);
            facets.put(Facet.PREVIOUS_MAJOR_STATUS, previousMajorStatus);
            measurements.put(Measurement.DAYS_IN_PREVIOUS_STATUS,
                             Long.valueOf(previousStatusDays));
            measurements.put(Measurement.DAYS_IN_PREVIOUS_MAJOR_STATUS,
                             Long.valueOf(previousMajorStatusDays));
            measurements.put(Measurement.DAYS_IN_STATUS,
                             Long.valueOf(isLatest ? -1 : msInStatus/day));
            measurements.put(Measurement.DAYS_IN_MAJOR_STATUS,
                             Long.valueOf(isLatest ? -1 : msInMajorStatus/day));
            measurements.put(Measurement.DAYS_OPEN_ACCUMULATED,
                             Long.valueOf(msOpenAccumulated/day));
            measurements.put(Measurement.TIMES_REOPENED,
                             Long.valueOf(reopened));
            measurements.put(Measurement.NUMBER,
                             Long.valueOf(number));

            previousStatus = status;
            previousMajorStatus = majorStatus;
            ++number;
        }

    }
}

