UPDATE feed_poll_status
SET etag = NULL, last_modified = NULL
WHERE etag IS NOT NULL OR last_modified IS NOT NULL;
