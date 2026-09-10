-- Up Migration
--
-- A school's logo, used for the browser tab, the Windows taskbar icon, the
-- sidebar, and the header of every report PDF.
--
-- Stored in the database rather than on disk because the desktop build runs
-- from a read-only install directory and is replaced wholesale on every
-- update; a file written beside the app would not survive either. The database
-- is also what already carries per-school data, and a logo belongs to a school
-- rather than to an installation.

CREATE TABLE school_logos (
    school_id CHAR(4) PRIMARY KEY,
    -- Exactly what was uploaded, kept so renditions can be rebuilt later
    -- without asking for the file again.
    original BYTEA NOT NULL,
    -- Windows .ico assembled from the renditions below.
    ico BYTEA NOT NULL,
    content_type VARCHAR(50) NOT NULL DEFAULT 'image/png',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_school_logo_school
        FOREIGN KEY (school_id)
        REFERENCES schools(school_id)
        ON DELETE CASCADE
);

-- One square PNG per icon size. Separate rows rather than a column per size so
-- the set of sizes can change without a schema change.
CREATE TABLE school_logo_renditions (
    school_id CHAR(4) NOT NULL,
    size INT NOT NULL,
    png BYTEA NOT NULL,

    PRIMARY KEY (school_id, size),

    CONSTRAINT fk_school_logo_rendition_school
        FOREIGN KEY (school_id)
        REFERENCES school_logos(school_id)
        ON DELETE CASCADE,

    CONSTRAINT chk_school_logo_rendition_size
        CHECK (size BETWEEN 1 AND 1024)
);

-- Down Migration

DROP TABLE IF EXISTS school_logo_renditions;
DROP TABLE IF EXISTS school_logos;
