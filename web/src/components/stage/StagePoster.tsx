import { DotPoster } from './DotPoster';

/**
 * The empty studio while the 3D stage loads, in the same paper tones as the
 * 3D cyclorama (Stage.tsx `BACKDROPS.light`): the wall falls into the floor at
 * `--stage-floor`, a soft contact shadow marks where the character will stand,
 * and the landing's dot silhouette waits there. Positions follow `--stage-x`
 * and `--stage-floor`.
 */
export function StagePoster() {
  return (
    <div aria-hidden="true" className="bg-paper-lift absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, var(--color-paper) 0%, var(--color-paper-lift) var(--stage-floor), var(--color-paper-deep) 100%)',
        }}
      />
      <div
        className="bg-ink/12 absolute h-[2.5%] w-[min(20vw,240px)] -translate-x-1/2 -translate-y-1/2 rounded-[50%] blur-md"
        style={{ left: 'var(--stage-x)', top: 'var(--stage-floor)' }}
      />
      <DotPoster />
    </div>
  );
}
