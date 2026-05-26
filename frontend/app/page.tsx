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
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-10 space-y-16 sm:py-14">
        {/* Top section: hero on the left, animated demo preview on the right.
            Stacks vertically below lg; preview goes under the hero on tablet
            so the CTA stays above the fold. */}
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
