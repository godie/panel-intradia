"use client";

import { TIMEFRAMES, TIMEFRAME_LABEL_KEY, type Timeframe } from "@/lib/timeframes";
import { useLanguage } from "@/hooks/use-language";

type Props = {
  /** Currently selected interval. */
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
};

/**
 * TimeframeSelector — the four supported candle intervals as a segmented
 * control. Purely presentational: the owner (page) holds and persists the
 * value, so this component has no state and no storage access.
 */
export function TimeframeSelector({ value, onChange }: Props) {
  const { t } = useLanguage();

  return (
    <div
      role="group"
      aria-label={t("tf.label")}
      className="inline-flex items-center gap-0.5 rounded-md border border-white/8 bg-black/20 p-0.5"
    >
      {TIMEFRAMES.map((tf) => {
        const active = tf === value;
        const label = t(TIMEFRAME_LABEL_KEY[tf]);
        return (
          <button
            key={tf}
            type="button"
            onClick={() => onChange(tf)}
            aria-pressed={active}
            title={`${t("tf.label")}: ${label}`}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#4fa8d8] ${
              active
                ? "bg-[#4fa8d8]/15 text-[#4fa8d8]"
                : "text-muted-foreground/60 hover:bg-white/10 hover:text-foreground/80"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
