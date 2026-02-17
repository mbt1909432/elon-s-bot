import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Bot, ArrowRight, Search, Code, Brain } from "lucide-react";
import { LandingNavbarClient } from "@/components/navbar-client";
import { AuthButton } from "@/components/auth-button";
import { hasEnvVars } from "@/lib/utils";

// Feature card component with proper hover and accessibility
function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="group p-4 sm:p-6 rounded-xl border bg-card hover:bg-accent/50 hover:border-primary/20 hover:shadow-lg transition-all duration-300 cursor-pointer active:scale-[0.98]">
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors duration-300">
          <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold mb-1.5 sm:mb-2 text-sm sm:text-base">{title}</h3>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

// Server component wrapper for navbar - passes AuthButton as children
function LandingNavbar() {
  const logo = (
    <Link
      href="/"
      className="flex items-center gap-2 font-semibold hover:opacity-80 transition-opacity cursor-pointer active:opacity-70"
    >
      <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-primary flex items-center justify-center">
        <Bot className="w-4 h-4 sm:w-5 sm:h-5 text-primary-foreground" />
      </div>
      <span className="text-sm sm:text-base">ElonsBot</span>
    </Link>
  );

  const desktopAuth = hasEnvVars ? (
    <Suspense>
      <AuthButton />
    </Suspense>
  ) : (
    <span className="text-muted-foreground text-xs">Setup required</span>
  );

  const mobileAuth = hasEnvVars ? (
    <Suspense>
      <AuthButton />
    </Suspense>
  ) : (
    <span className="text-xs text-muted-foreground">Setup required</span>
  );

  return (
    <nav className="fixed top-2 sm:top-4 left-2 sm:left-4 right-2 sm:right-4 z-50">
      <LandingNavbarClient logo={logo} desktopAuth={desktopAuth} mobileAuth={mobileAuth} />
    </nav>
  );
}

export default function Home() {
  return (
    <main className="min-h-[100dvh] flex flex-col bg-gradient-to-b from-background to-muted/30">
      {/* Navbar with mobile menu */}
      <LandingNavbar />

      {/* Hero Section - Mobile optimized with fluid typography */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 pt-20 sm:pt-24 pb-12 sm:pb-16">
        <div className="flex flex-col items-center text-center max-w-3xl mx-auto w-full">
          {/* Animated Logo - Responsive sizing */}
          <div className="relative mb-6 sm:mb-8">
            <div className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-xl shadow-primary/20">
              <Bot className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-primary-foreground" />
            </div>
            <div className="absolute -inset-3 sm:-inset-4 bg-primary/20 rounded-3xl blur-2xl -z-10" />
          </div>

          {/* Headline - Fluid typography */}
          <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold mb-3 sm:mb-4 tracking-tight px-2">
            Your Intelligent
            <span className="text-primary"> AI Assistant</span>
          </h1>

          {/* Description - Fluid typography */}
          <p className="text-base sm:text-lg md:text-xl text-muted-foreground mb-6 sm:mb-8 max-w-2xl leading-relaxed px-2">
            Harness the power of AI with web search, Python execution, and persistent memory.
            <span className="hidden sm:inline"> Your personal assistant that learns and grows with you.</span>
          </p>

          {/* CTA Buttons - Stack on mobile */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-10 sm:mb-16 w-full sm:w-auto px-4 sm:px-0">
            {hasEnvVars ? (
              <Link href="/protected" className="cursor-pointer w-full sm:w-auto">
                <Button
                  size="lg"
                  className="gap-2 h-12 sm:h-12 px-6 sm:px-8 text-base w-full sm:w-auto shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 active:scale-[0.98]"
                >
                  Start Chatting
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </Link>
            ) : (
              <Link href="/auth/sign-up" className="cursor-pointer w-full sm:w-auto">
                <Button
                  size="lg"
                  className="gap-2 h-12 sm:h-12 px-6 sm:px-8 text-base w-full sm:w-auto shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 active:scale-[0.98]"
                >
                  Get Started
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </Link>
            )}
            <a href="#features" className="cursor-pointer w-full sm:w-auto">
              <Button
                variant="outline"
                size="lg"
                className="h-12 px-6 sm:px-8 text-base w-full sm:w-auto active:scale-[0.98]"
              >
                Learn More
              </Button>
            </a>
          </div>

          {/* Features Grid - Responsive */}
          <div id="features" className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 text-left">
            <FeatureCard
              icon={Search}
              title="Web Search"
              description="Real-time web search powered by Brave Search API."
            />
            <FeatureCard
              icon={Code}
              title="Python Sandbox"
              description="Execute Python code in a secure sandbox."
            />
            <FeatureCard
              icon={Brain}
              title="Memory System"
              description="Remembers your preferences and context."
            />
          </div>
        </div>
      </div>

      {/* Footer - Mobile optimized */}
      <footer className="w-full flex items-center justify-center border-t py-6 sm:py-8 text-xs sm:text-sm text-muted-foreground px-4">
        <p className="flex flex-wrap items-center justify-center gap-1 sm:gap-2 text-center">
          Powered by
          <span className="font-medium text-foreground">Next.js</span>,
          <span className="font-medium text-foreground">Supabase</span> &
          <span className="font-medium text-foreground">Acontext</span>
        </p>
      </footer>
    </main>
  );
}
