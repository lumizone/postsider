import { OauthCallback } from "@/components/oauth-callback";

export const metadata = {
  title: "Connecting…",
};

export default async function SocialOauthCallbackPage(props: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await props.params;
  return <OauthCallback provider={provider} />;
}
