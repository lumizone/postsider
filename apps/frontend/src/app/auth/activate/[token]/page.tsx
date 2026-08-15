import { ActivateClient } from "@/components/auth/activate-client";

export const metadata = {
  title: "Activate account · PostSider",
};

// The activation email links here: ${FRONTEND_URL}/auth/activate/<jwt>.
export default async function ActivatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ActivateClient token={token} />;
}
