"use client";

import { Calendar } from "@/components/calendar";
import { useT } from "@/lib/i18n";

export default function CalendarPage() {
  const t = useT();
  const today = new Date();
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span
        style={{
          fontSize: "12px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: "var(--muted)",
        }}
      >
        {t("calendar.eyebrow" as any)}
      </span>
      <Calendar year={today.getFullYear()} month={today.getMonth()} />
    </section>
  );
}
