import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

// SVG icons for social providers
const GoogleIcon = () => (
  <svg aria-hidden="true" className="h-4 w-4" role="img" viewBox="0 0 24 24">
    <title>Google</title>
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

const GitHubIcon = () => (
  <svg
    aria-hidden="true"
    className="h-4 w-4"
    fill="currentColor"
    role="img"
    viewBox="0 0 24 24"
  >
    <title>GitHub</title>
    <path
      clipRule="evenodd"
      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      fillRule="evenodd"
    />
  </svg>
);

export function SocialButtons() {
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isLoadingGitHub, setIsLoadingGitHub] = useState(false);

  const handleGoogleSignIn = async () => {
    setIsLoadingGoogle(true);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: `${window.location.origin}/dashboard`,
      });

      // If we get a URL back, redirect manually
      if (result?.data?.url) {
        window.location.href = result.data.url;
      } else if (result?.error) {
        toast.error(result.error.message || "Failed to sign in with Google");
        setIsLoadingGoogle(false);
      }
    } catch (error) {
      console.error("Google sign-in error:", error);
      toast.error("Failed to sign in with Google");
      setIsLoadingGoogle(false);
    }
  };

  const handleGitHubSignIn = async () => {
    setIsLoadingGitHub(true);
    try {
      await authClient.signIn.social({
        provider: "github",
        callbackURL: "/dashboard",
      });
    } catch (_error) {
      toast.error("Failed to sign in with GitHub");
      setIsLoadingGitHub(false);
    }
  };

  return (
    <div className="grid gap-3">
      <Button
        className="w-full border-zinc-800 bg-transparent text-white hover:bg-zinc-900 hover:text-white"
        disabled={isLoadingGoogle || isLoadingGitHub}
        onClick={handleGoogleSignIn}
        variant="outline"
      >
        {isLoadingGoogle ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <GoogleIcon />
        )}
        <span className="ml-2">Continue with Google</span>
      </Button>

      <Button
        className="w-full border-zinc-800 bg-transparent text-white hover:bg-zinc-900 hover:text-white"
        disabled={isLoadingGoogle || isLoadingGitHub}
        onClick={handleGitHubSignIn}
        variant="outline"
      >
        {isLoadingGitHub ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <GitHubIcon />
        )}
        <span className="ml-2">Continue with GitHub</span>
      </Button>
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-zinc-800 border-t" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-[#0a0a0b] px-2 text-zinc-500">
          Or continue with
        </span>
      </div>
    </div>
  );
}
