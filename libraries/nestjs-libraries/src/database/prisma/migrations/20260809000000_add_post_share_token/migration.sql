-- AlterTable
ALTER TABLE "Post" ADD COLUMN "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Post_shareToken_key" ON "Post"("shareToken");
