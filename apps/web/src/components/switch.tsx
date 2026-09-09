"use client";

/**
 * A labelled on/off switch (`role="switch"`), label on the left. `pending`
 * keeps it interactive-looking but marks it busy (knob pulses, aria-busy)
 * while the change is being saved — callers flip `checked` optimistically
 * so the tap is acknowledged at once.
 */
export function Switch({
  id,
  label,
  checked,
  disabled,
  pending,
  onToggle,
  title,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  pending?: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <label
      htmlFor={id}
      title={title}
      className={`flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 ${
        disabled ? "cursor-default" : "cursor-pointer"
      }`}
    >
      {label}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-busy={pending || undefined}
        disabled={disabled || pending}
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed ${
          disabled ? "opacity-60" : ""
        } ${checked ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"}`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          } ${pending ? "animate-pulse opacity-70" : ""}`}
        />
      </button>
    </label>
  );
}
