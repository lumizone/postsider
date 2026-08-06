import { Analytics } from "@/components/analytics";
import { SectionIntro } from "@/components/section-intro";

export const metadata = {
  title: "Analytics · PostSider",
};

export default function AnalyticsPage() {
  return (
    <>
      <SectionIntro
        id="analytics"
        titleKey="sectionIntro.analyticsTitle"
        bodyKey="sectionIntro.analyticsBody"
      />
      <Analytics />
    </>
  );
}
