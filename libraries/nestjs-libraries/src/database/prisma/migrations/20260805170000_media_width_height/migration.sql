-- Add nullable width/height (px) to Media so the media library can show real
-- image dimensions instead of always falling back to "—". Populated at
-- upload time for images via sharp; NULL for pre-existing rows and any
-- media type we don't probe (video/audio, presigned/R2-multipart uploads).
ALTER TABLE "Media" ADD COLUMN "width" INTEGER;
ALTER TABLE "Media" ADD COLUMN "height" INTEGER;
