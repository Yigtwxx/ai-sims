'use client';

interface SwatchesProps {
  label: string;
  colors: readonly string[];
  value: string;
  onChange: (color: string) => void;
  /** Accessible name for each colour; the first entry is usually "original". */
  names?: readonly string[];
  disabled?: boolean;
  size?: 'sm' | 'lg';
}

/**
 * Circular colour chips. White means "keep the authored colour", drawn as a
 * split chip so it never reads as plain white paint.
 */
export function Swatches({
  label,
  colors,
  value,
  onChange,
  names,
  disabled,
  size = 'sm',
}: SwatchesProps) {
  const dimension = size === 'lg' ? 'h-9 w-9' : 'h-7 w-7';
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled}
      className={`flex flex-wrap items-center gap-2.5 ${disabled ? 'pointer-events-none opacity-35' : ''}`}
    >
      {colors.map((color, i) => {
        const selected = color.toLowerCase() === value.toLowerCase();
        const isOriginal = color.toLowerCase() === '#ffffff';
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={names?.[i] ?? color}
            title={names?.[i]}
            onClick={() => onChange(color)}
            className={`relative ${dimension} ease-out-expo shrink-0 rounded-full transition-transform duration-300 hover:scale-110 focus-visible:scale-110`}
          >
            <span
              className="absolute inset-0 rounded-full ring-1 ring-white/15 ring-inset"
              style={{
                background: isOriginal
                  ? 'conic-gradient(from 225deg, #f4f1ec 0 50%, #3a3740 50% 100%)'
                  : color,
              }}
            />
            <span
              className={`absolute -inset-[4px] rounded-full ring-2 transition-opacity duration-300 ${
                selected ? 'ring-marquee opacity-100' : 'opacity-0 ring-transparent'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
