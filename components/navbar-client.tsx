'use client';

import { useState, useEffect } from 'react';
import { ThemeSwitcher } from "@/components/theme-switcher";
import { MobileMenuToggle } from "@/components/mobile-menu-toggle";

interface LandingNavbarClientProps {
  logo: React.ReactNode;
  desktopAuth: React.ReactNode;
  mobileAuth: React.ReactNode;
}

export function LandingNavbarClient({ logo, desktopAuth, mobileAuth }: LandingNavbarClientProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Close menu on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 640) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="max-w-5xl mx-auto bg-background/80 backdrop-blur-lg border rounded-2xl sm:rounded-full px-4 sm:px-6 py-2.5 sm:py-3 shadow-sm">
      <div className="flex justify-between items-center">
        {/* Logo passed from server component */}
        {logo}

        {/* Desktop Navigation */}
        <div className="hidden sm:flex items-center gap-3">
          <ThemeSwitcher />
          {desktopAuth}
        </div>

        {/* Mobile Menu Button */}
        <MobileMenuToggle
          isOpen={isMobileMenuOpen}
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        />
      </div>

      {/* Mobile Menu Dropdown */}
      {isMobileMenuOpen && (
        <div className="sm:hidden mt-3 pt-3 border-t flex flex-col gap-3 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Theme</span>
            <ThemeSwitcher />
          </div>
          {mobileAuth}
        </div>
      )}
    </div>
  );
}
