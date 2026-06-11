import { Suspense } from "react";
import { SetupForm } from "@/components/auth/setup-form";

export const metadata = {
  title: "Set up your account · PostSider",
};

export default function SetupPage() {
  return (
    <Suspense fallback={null}>
      <SetupForm />
    </Suspense>
  );
}
