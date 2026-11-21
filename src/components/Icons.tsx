import type { SVGProps } from "react";
import { useRouter } from "../router/RouterContext";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
});

export const useNavigate = () => {
  const navigate = useRouter()?.navigate ?? (() => undefined);
  return navigate;
};

export const SIGN_ON_PATH = "/login";

export function SearchIcon({ size = 22, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

export function CloseIcon({ size = 20, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

export function ChevronRight({ size = 18, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function ChevronDown({ size = 18, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronLeft({ size = 18, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}
