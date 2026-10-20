import type { CSSProperties } from 'react';

/** Dust motes drifting up through the beam: fixed positions so server and client agree. */
const MOTES: readonly { x: number; y: number; size: number; delay: number; duration: number }[] = [
  { x: -9, y: 62, size: 2, delay: 0, duration: 15 },
  { x: -4, y: 44, size: 1.5, delay: 3.2, duration: 19 },
  { x: 3, y: 70, size: 2.5, delay: 1.4, duration: 17 },
  { x: 8, y: 36, size: 1.5, delay: 5.6, duration: 21 },
  { x: -13, y: 28, size: 1, delay: 2.1, duration: 23 },
  { x: 12, y: 58, size: 2, delay: 7.4, duration: 16 },
  { x: -1, y: 22, size: 1, delay: 4.8, duration: 24 },
  { x: 6, y: 50, size: 1.5, delay: 9.1, duration: 18 },
  { x: -7, y: 78, size: 2, delay: 6.3, duration: 20 },
  { x: 15, y: 40, size: 1, delay: 1.9, duration: 22 },
  { x: -16, y: 52, size: 1.5, delay: 8.2, duration: 19 },
  { x: 1, y: 84, size: 1, delay: 10.4, duration: 17 },
];

/**
 * The lit, empty stage drawn in CSS: a cyclorama falloff, a soft spotlight
 * cone with haze and dust, a floor pool, a small amber spike mark where the
 * character will stand, a slow light sweep and a vignette. The lamps "warm
 * up" once on load. Positions follow `--stage-x` and `--stage-floor`.
 */
export function StagePoster() {
  return (
    <div aria-hidden="true" className="bg-backstage-deep absolute inset-0 overflow-hidden">
      {/* Cyclorama: the wall catches the spill of the spot. */}
      <div
        className="animate-lamp-on absolute inset-0"
        style={{
          animationDelay: '120ms',
          background:
            'radial-gradient(46% 64% at var(--stage-x) 36%, rgb(255 226 176 / 0.12), rgb(255 226 176 / 0.035) 48%, transparent 76%)',
        }}
      />

      {/* A slow sweep of light across the wall, like a follow-spot finding its mark. */}
      <div className="animate-light-sweep absolute inset-y-0 left-0 w-[30%] opacity-0 [animation-delay:2.4s]">
        <div className="size-full bg-[linear-gradient(90deg,transparent,rgb(255_236_212/0.05),transparent)]" />
      </div>

      {/* Spotlight cone: blur on the wrapper so the clipped beam gets soft edges. */}
      <div
        className="animate-lamp-on absolute top-[-6%] h-[94%] w-[min(74vw,900px)] -translate-x-1/2 blur-[34px]"
        style={{ left: 'var(--stage-x)' }}
      >
        <div
          className="size-full"
          style={{
            clipPath: 'polygon(42% 0, 58% 0, 100% 100%, 0 100%)',
            background:
              'linear-gradient(to bottom, rgb(255 234 200 / 0.26), rgb(255 226 176 / 0.09) 52%, rgb(255 226 176 / 0.025) 86%, transparent)',
          }}
        />
      </div>
      <div
        className="animate-lamp-on absolute top-[-6%] h-[92%] w-[min(40vw,480px)] -translate-x-1/2 blur-[18px]"
        style={{ left: 'var(--stage-x)', animationDelay: '220ms' }}
      >
        <div
          className="size-full"
          style={{
            clipPath: 'polygon(46% 0, 54% 0, 92% 100%, 8% 100%)',
            background:
              'linear-gradient(to bottom, rgb(255 240 214 / 0.2), rgb(255 230 190 / 0.05) 62%, transparent)',
          }}
        />
      </div>

      {/* Haze drifting inside the beam. */}
      <div
        className="animate-haze-drift absolute top-[18%] h-[52%] w-[min(52vw,640px)] -translate-x-1/2 opacity-70 blur-3xl"
        style={{
          left: 'var(--stage-x)',
          background:
            'radial-gradient(closest-side, rgb(255 230 196 / 0.1), transparent), radial-gradient(40% 30% at 30% 70%, rgb(255 230 196 / 0.06), transparent)',
        }}
      />

      {/* Dust motes. */}
      <div
        className="absolute top-0 h-full w-[min(40vw,520px)] -translate-x-1/2 motion-reduce:hidden"
        style={{ left: 'var(--stage-x)' }}
      >
        {MOTES.map((mote, index) => (
          <span
            key={index}
            className="bg-tungsten absolute rounded-full"
            style={
              {
                left: `calc(50% + ${mote.x}%)`,
                top: `${mote.y}%`,
                width: mote.size,
                height: mote.size,
                opacity: 0,
                animation: `mote-drift ${mote.duration}s linear ${mote.delay}s infinite`,
              } as CSSProperties
            }
          />
        ))}
      </div>

      {/* Floor pool. */}
      <div
        className="animate-lamp-on absolute h-[24%] w-[min(78vw,960px)] -translate-x-1/2 -translate-y-1/2"
        style={{
          left: 'var(--stage-x)',
          top: 'var(--stage-floor)',
          animationDelay: '320ms',
          background:
            'radial-gradient(closest-side, rgb(255 228 184 / 0.2), rgb(255 226 176 / 0.06) 58%, transparent)',
        }}
      />

      {/* Spike mark: where the character will stand. */}
      <div
        className="animate-lamp-on absolute -translate-x-1/2 -translate-y-1/2 [animation-delay:900ms]"
        style={{ left: 'var(--stage-x)', top: 'var(--stage-floor)' }}
      >
        <div className="relative h-6 w-14 [transform:perspective(240px)_rotateX(62deg)]">
          <span className="bg-marquee/75 absolute top-1/2 left-0 h-[3px] w-full -translate-y-1/2" />
          <span className="bg-marquee/75 absolute top-0 left-1/2 h-full w-[3px] -translate-x-1/2" />
        </div>
      </div>

      {/* Vignette and the fade into the page below. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(125% 95% at var(--stage-x) 42%, transparent 48%, rgb(11 11 10 / 0.9) 100%)',
        }}
      />
      <div className="to-backstage absolute inset-x-0 bottom-0 h-48 bg-linear-to-b from-transparent" />
    </div>
  );
}
