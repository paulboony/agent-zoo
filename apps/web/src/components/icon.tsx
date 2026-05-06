import { cn } from "@/lib/cn.js";

interface Props {
  name: string;
  className?: string;
}

export function Icon({ name, className }: Props) {
  return (
    <span
      aria-hidden="true"
      className={cn("material-symbols-outlined translate-y-[1px] text-[1.1em]", className)}
    >
      {name}
    </span>
  );
}
