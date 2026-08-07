import { Posts } from "@/components/posts";
import { SectionIntro } from "@/components/section-intro";

export const metadata = {
  title: "Posts · PostSider",
};

export default function PostsPage() {
  return (
    <>
      <SectionIntro
        id="posts"
        titleKey="sectionIntro.postsTitle"
        bodyKey="sectionIntro.postsBody"
      />
      <Posts />
    </>
  );
}
