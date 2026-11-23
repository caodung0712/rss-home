export type TagColorKey =
  | "emerald"
  | "blue"
  | "violet"
  | "amber"
  | "rose"
  | "cyan"
  | "orange"
  | "slate";

export const TAG_COLORS: Record<
  TagColorKey,
  { labelVi: string; labelEn: string; dot: string; badge: string }
> = {
  emerald: {
    labelVi: "Xanh lá",
    labelEn: "Emerald",
    dot: "bg-emerald-500",
    badge:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/80",
  },
  blue: {
    labelVi: "Xanh dương",
    labelEn: "Blue",
    dot: "bg-blue-500",
    badge:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/80",
  },
  violet: {
    labelVi: "Tím",
    labelEn: "Violet",
    dot: "bg-violet-500",
    badge:
      "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800/80",
  },
  amber: {
    labelVi: "Vàng hổ phách",
    labelEn: "Amber",
    dot: "bg-amber-500",
    badge:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/80",
  },
  rose: {
    labelVi: "Hồng đỏ",
    labelEn: "Rose",
    dot: "bg-rose-500",
    badge:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/80",
  },
  cyan: {
    labelVi: "Xanh ngọc",
    labelEn: "Cyan",
    dot: "bg-cyan-500",
    badge:
      "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800/80",
  },
  orange: {
    labelVi: "Cam",
    labelEn: "Orange",
    dot: "bg-orange-500",
    badge:
      "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800/80",
  },
  slate: {
    labelVi: "Xám",
    labelEn: "Slate",
    dot: "bg-slate-500",
    badge:
      "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  },
};

export function normalizeTagColor(color?: string | null): TagColorKey {
  if (color && color in TAG_COLORS) {
    return color as TagColorKey;
  }
  return "emerald";
}

export function getTagStyle(color?: string | null) {
  return TAG_COLORS[normalizeTagColor(color)];
}
