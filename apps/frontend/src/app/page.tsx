import { Suspense } from "react";
import { HomeRedirect } from "@/components/home-redirect";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeRedirect />
    </Suspense>
  );
}
