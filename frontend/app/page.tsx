import { CTASection } from "@/components/landing/CTASection";
import { DemoPreview } from "@/components/landing/DemoPreview";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { Header } from "@/components/Header";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingHero } from "@/components/landing/LandingHero";
import { StatsStrip } from "@/components/landing/StatsStrip";

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <Header />
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-10 space-y-16 sm:py-14">
        <LandingHero />
        <DemoPreview />
        <StatsStrip />
        <HowItWorks />
        <FeatureGrid />
        <CTASection />
      </main>
    </div>
  );
}
