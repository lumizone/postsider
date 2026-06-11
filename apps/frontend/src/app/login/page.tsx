import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = {
  title: "Sign in · PostSider",
};

// LoginForm uses useSearchParams() to detect ?org=<jwt> invite tokens, which
// Next 15 only allows under a Suspense boundary at the page level.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
