import { EnvVarWarning } from "@/components/env-var-warning";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";
import { Bot } from "lucide-react";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-[100dvh] flex flex-col">
      {/* Navigation - Mobile optimized */}
      <nav className="w-full flex justify-center border-b border-b-foreground/10 h-12 sm:h-14 flex-shrink-0">
        <div className="w-full max-w-5xl flex justify-between items-center px-3 sm:px-4 text-sm">
          {/* Logo */}
          <Link
            href="/protected"
            className="flex items-center gap-2 font-semibold hover:opacity-80 transition-opacity cursor-pointer active:opacity-70"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-primary flex items-center justify-center">
              <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary-foreground" />
            </div>
            <span className="text-sm sm:text-base">ElonsBot</span>
          </Link>

          {/* Right side actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeSwitcher />
            {!hasEnvVars ? (
              <EnvVarWarning />
            ) : (
              <Suspense>
                <AuthButton />
              </Suspense>
            )}
          </div>
        </div>
      </nav>

      {/* Main content area - Takes remaining space */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {children}
      </div>
    </main>
  );
}
