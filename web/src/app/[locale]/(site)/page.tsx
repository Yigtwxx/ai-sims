import { PageTransition } from '@/components/shell/PageTransition';
import { ParticleStory } from '@/features/landing/ParticleStory';

/**
 * Landing ("Paper and Ink", DESIGN.md): no character on screen, only ink dots
 * on paper that tell the product in five chapters as the page scrolls, ending
 * on a human silhouette sampled from a real MetaHuman and the start button.
 */
export default function LandingPage() {
  return (
    <PageTransition>
      <ParticleStory />
    </PageTransition>
  );
}
