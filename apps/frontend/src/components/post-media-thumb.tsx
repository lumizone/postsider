"use client";

/**
 * Small thumbnail for a post's first media attachment (image or video).
 * Renders nothing when there is no media, so callers can slot it in front of
 * an event/row without extra conditional branches.
 */
export function PostMediaThumb({
  media,
  size = 22,
}: {
  media?: { url: string; kind: "image" | "video" }[];
  size?: number;
}) {
  const first = media?.[0];
  if (!first?.url) return null;
  return (
    <span
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: 5,
        overflow: "hidden",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgb(var(--tint) / 0.06)",
      }}
      aria-hidden
    >
      {first.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={first.url}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={first.url}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "grayscale(0.2)",
          }}
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      {first.kind === "video" && (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: Math.max(8, Math.round(size * 0.5)),
            lineHeight: 1,
            textShadow: "0 1px 2px rgb(var(--shadow) / calc(0.5 * var(--shadow-boost)))",
          }}
        >
          ▶
        </span>
      )}
    </span>
  );
}
