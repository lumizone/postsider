import { Suspense } from "react";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

export const metadata = {
  title: "Get started · PostSider",
};

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingFlow />
    </Suspense>
  );
}
