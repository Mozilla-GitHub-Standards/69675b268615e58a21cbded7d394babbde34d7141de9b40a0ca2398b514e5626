package com.mozilla.bugzilla_etl.model.attachment;

import com.mozilla.bugzilla_etl.model.bug.Flag;


/**
 * A bugzilla review request.
 */
public class Request extends Flag {

    private final String requestee;

    public Request(String name, Status status, String requestee) {
        super(name, status);
        this.requestee = requestee;
    }

    public static Request fromRepresentation(String representation) {
        final Flag flag = Flag.fromRepresentation(representation);
        int from = representation.indexOf('(');
        if (from == -1) {
            return new Request(flag.name(), flag.status(), null);
        }
        int to = representation.indexOf(')');
        if (to == -1) {
            final String msg =
                String.format("Unclosed parens in review request ''",
                              representation);
            throw new IllegalArgumentException(msg);
        }
        String requestee = representation.substring(from+1, to);
        return new Request(flag.name(), flag.status(), requestee);
    }

    public String requestee() {
        return requestee;
    }

    public String representation() {
        if (requestee == null) {
            return super.representation();
        }
        return new StringBuilder(super.representation())
               .append('(').append(requestee).append(')').toString();
    }

}