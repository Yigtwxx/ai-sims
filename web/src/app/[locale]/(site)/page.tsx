/*
 * THESIS: The landing is a premiere, not a product page: one lit, empty stage
 * waiting for a photoreal character, with the copy set like opening credits.
 * It refuses the centred-hero-plus-three-feature-cards template.
 * OWN-WORLD: Warm graphite backstage, one marquee amber, tungsten spotlight
 * cones and floor pools, film grain, Mona Sans expanded in sentence case,
 * 1px hairlines and an amber spike mark.
 * STORY: See the stage, learn it is your character's; look closer (realism),
 * see what you can change, hear it speak with word-synced lips, then press
 * "Karakterini oluştur".
 * FIRST VIEWPORT: Full-bleed stage under a transparent header, spot at 64%
 * width with a floor mark; two-line title, one-sentence lede and the amber
 * CTA anchored bottom-left in the dark.
 * FORM: Brief-pinned "Karanlık sinematik" (photoreal Premiere Wall); no seed
 * roll, the user chose the direction.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReactNode } from 'react';

import { ClosingSection } from '@/components/landing/ClosingSection';
import { CustomizeSection } from '@/components/landing/customize/CustomizeSection';
import { Hero } from '@/components/landing/Hero';
import { RealismSection } from '@/components/landing/RealismSection';
import { TalkDemo } from '@/components/landing/talk/TalkDemo';
import { TechMarquee } from '@/components/landing/TechMarquee';
import { PageTransition } from '@/components/shell/PageTransition';

const SAMPLE_AUDIO = '/assets/samples/tr-greeting.wav';
const TALK_ANCHOR = 'konusma';

/** Transcript of the sample recording, read once at build time. */
async function getSampleTranscript(): Promise<string> {
  'use cache';
  const file = path.join(process.cwd(), 'public', 'assets', 'samples', 'tr-greeting.txt');
  return (await readFile(file, 'utf8')).trim();
}

/**
 * Slots for the main session: pass the live 3D character into `heroStage`
 * and a face close-up into `closeUp`; until then the posters render.
 */
const heroStage: ReactNode = undefined;
const closeUp: ReactNode = undefined;

export default async function LandingPage() {
  const transcript = await getSampleTranscript();

  return (
    <PageTransition>
      <Hero stage={heroStage} talkAnchor={TALK_ANCHOR} />
      <TechMarquee />
      <RealismSection closeUp={closeUp} />
      <CustomizeSection />
      <TalkDemo id={TALK_ANCHOR} audioSrc={SAMPLE_AUDIO} transcript={transcript} />
      <ClosingSection />
    </PageTransition>
  );
}
