-- Add Media.durationSeconds: the container-level length of a video upload,
-- probed with ffprobe at upload time. Used at post validation to enforce
-- per-account video length limits (e.g. TikTok max_video_post_duration_sec)
-- server-side for the dashboard and the public API.
--
-- Additive and nullable: existing rows keep NULL, and only video uploads
-- recorded after this migration carry a value.
ALTER TABLE "Media" ADD COLUMN "durationSeconds" INTEGER;
