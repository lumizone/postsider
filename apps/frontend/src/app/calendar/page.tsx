"use client";

import { Calendar } from "@/components/calendar";

export default function CalendarPage() {
  const today = new Date();
  return <Calendar year={today.getFullYear()} month={today.getMonth()} />;
}
