import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("h-9 w-9", className)} aria-hidden>
      <rect width="40" height="40" rx="11" className="fill-primary" />
      <path d="M14 11v18h5.5a9 9 0 000-18z" className="fill-none stroke-primary-foreground" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="28.5" cy="12.5" r="3.5" className="fill-primary-glow" />
    </svg>
  );
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <span className={cn("font-display text-lg font-semibold tracking-tight", light ? "text-primary-foreground" : "text-foreground")}>
        Day<span className="text-primary-glow">flow</span>
      </span>
    </div>
  );
}
