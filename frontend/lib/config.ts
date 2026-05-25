// Project-level constants the UI references in multiple places.

// Override at build time with NEXT_PUBLIC_GITHUB_URL=...
export const GITHUB_URL =
  process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/arnavraj-7/sentinel";

export const PROJECT_NAME = "Sentinel";
export const PROJECT_TAGLINE = "AI SRE Copilot";

// Used in metadata + the hero
export const PROJECT_BLURB =
  "A multi-agent SRE that diagnoses production incidents, plans " +
  "remediation, and writes verified code patches — with humans in the loop.";
