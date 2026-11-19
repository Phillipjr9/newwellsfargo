import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function Dialog({ children, className, label, id, onClose }: {
  children: ReactNode;
  className?: string;
  label: string;
  id?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const active = document.activeElement;
    const scrollStyle = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";

    return () => {
      dialog.close();
      document.body.style.overflow = scrollStyle;
      if (active instanceof HTMLElement) active.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog
      id={id}
      className={`wf-dialog ${className ?? ""}`}
      ref={ref}
      aria-label={label}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom) onClose();
        }
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}