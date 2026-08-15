import { GuestReviewView } from "@/components/guest-review-view";

export const metadata = {
  title: "Review post · PostSider",
};

// Guest approval link minted by an org admin: /review/<token>. No account.
export default async function GuestReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <GuestReviewView token={token} />;
}
