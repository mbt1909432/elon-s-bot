'use client';

import { Menu, X } from "lucide-react";

export function MobileMenuToggle({
  isOpen,
  onClick,
}: {
  isOpen: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="sm:hidden h-11 w-11 flex items-center justify-center rounded-full hover:bg-accent transition-colors cursor-pointer"
      aria-label={isOpen ? "Close menu" : "Open menu"}
      aria-expanded={isOpen}
    >
      {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
    </button>
  );
}
