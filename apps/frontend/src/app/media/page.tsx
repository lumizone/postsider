import { Media } from "@/components/media";
import { SectionIntro } from "@/components/section-intro";

export const metadata = {
  title: "Media · PostSider",
};

export default function MediaPage() {
  return (
    <>
      <SectionIntro
        id="media"
        titleKey="sectionIntro.mediaTitle"
        bodyKey="sectionIntro.mediaBody"
      />
      <Media />
    </>
  );
}
