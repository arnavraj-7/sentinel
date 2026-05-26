import { CTASection } from "@/components/landing/CTASection";
import { DemoPreview } from "@/components/landing/DemoPreview";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { Header } from "@/components/Header";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingHero } from "@/components/landing/LandingHero";
import { SetupGuide } from "@/components/landing/SetupGuide";
import { StatsStrip } from "@/components/landing/StatsStrip";

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <Header />
      {/* page-ambience adds a soft radial accent + faint grid that fades
          from the top — gives the long landing page a sense of depth
          instead of stacked rectangles on a flat bg. */}
      <main className="relative page-ambience mx-auto w-full max-w-[1400px] flex-1 px-6 py-10 space-y-20 sm:py-14">
        <section className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_minmax(0,560px)]">
          <LandingHero />
          <DemoPreview />
        </section>

        <StatsStrip />
        <section id="how" className="scroll-mt-20">
          <HowItWorks />
        </section>
        <section id="features" className="scroll-mt-20">
          <FeatureGrid />
        </section>
        <SetupGuide />
        <CTASection />
      </main>
    </div>
  );
}
