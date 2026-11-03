"use client";

import { Calendar } from "@/components/calendar";
import { OnboardingResumeBanner } from "@/components/onboarding/onboarding-resume";

export default function CalendarPage() {
  const today = new Date();
  return (
    <>
      <OnboardingResumeBanner />
      <Calendar year={today.getFullYear()} month={today.getMonth()} />
    </>
  );
}
