import { motion } from "framer-motion";

interface Props {
  totalSteps: number;       // 11 (0..10 inclusive)
  height: number;           // px of usable scene
  width: number;            // px
  status: "setup" | "precheck" | "running" | "ended";
}

export default function Stairs({ totalSteps, height, width, status }: Props) {
  const stepHeight = height / totalSteps;
  const steps = Array.from({ length: totalSteps }, (_, i) => i); // 0..10
  const isRunning = status === "running";

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      aria-hidden
    >
      {/* Continuous downward scroll on running to imply gravity / rising challenge */}
      <motion.div
        className="absolute inset-0 floor-stripes opacity-40"
        animate={isRunning ? { backgroundPositionY: ["0px", "120px"] } : { backgroundPositionY: "0px" }}
        transition={{ duration: 4, ease: "linear", repeat: Infinity }}
      />
      {steps.map((s) => {
        const top = (totalSteps - 1 - s) * stepHeight;
        const isTop = s === totalSteps - 1;
        return (
          <div
            key={s}
            className="absolute left-0 right-0 flex items-end"
            style={{ top, height: stepHeight }}
          >
            <div
              className={
                "h-px w-full mx-6 " +
                (isTop ? "bg-g-yellow/60" : "bg-g-blue/25")
              }
            />
            <div
              className="absolute left-2 -top-2 text-[10px] font-mono tabular text-ink-300"
              style={{ width: 28, textAlign: "right" }}
            >
              {s}
            </div>
            {isTop && (
              <div className="absolute right-4 -top-4 text-[11px] font-bold text-g-yellow tracking-wider">
                FINISH · 10 PTS
              </div>
            )}
          </div>
        );
      })}
      {/* Subtle horizontal vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(7,11,31,0.65) 0%, transparent 14%, transparent 86%, rgba(7,11,31,0.65) 100%)",
        }}
      />
      {/* width prop is consumed implicitly via parent layout */}
      <span className="hidden">{width}</span>
    </div>
  );
}
