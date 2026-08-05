import { api } from "./api";
import type { MediaItem } from "./media-data";

export interface BackendMedia {
  id: string;
  name: string;
  originalName: string | null;
  path: string;
  thumbnail: string | null;
  alt: string | null;
  type: "image" | "video" | "audio";
  thumbnailTimestamp?: number | null;
  fileSize?: number;
  width?: number | null;
  height?: number | null;
  createdAt: string;
}

export interface MediaPage {
  pages: number;
  results: BackendMedia[];
}

function withBase(path: string): string {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  // Locally-stored uploads are served from /uploads/<name> by the backend.
  const base = (
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  if (path.startsWith("/")) return base + path;
  return `${base}/uploads/${path}`;
}

export function backendMediaToItem(m: BackendMedia): MediaItem {
  const kind: "image" | "video" =
    m.type === "video" ? "video" : "image"; // audio still goes under "image" thumb fallback
  return {
    id: m.id,
    name: m.originalName || m.name,
    kind,
    size: m.fileSize ?? 0,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    uploadedAt: m.createdAt,
    channelId: null,
  };
}

export function backendMediaToUrl(m: BackendMedia): string {
  return withBase(m.path);
}

export async function fetchMedia(
  page = 1,
  search?: string,
): Promise<MediaPage> {
  return api.get<MediaPage>("/media", { page, search });
}

export async function deleteMediaItem(id: string): Promise<void> {
  await api.del(`/media/${id}`);
}

export interface UploadedMediaResponse {
  id: string;
  name: string;
  originalName: string | null;
  path: string;
  thumbnail: string | null;
  alt: string | null;
  type: "image" | "video" | "audio";
}

export async function uploadMedia(file: File): Promise<UploadedMediaResponse> {
  const fd = new FormData();
  fd.append("file", file);
  return api.upload<UploadedMediaResponse>("/media/upload-simple", fd);
}
