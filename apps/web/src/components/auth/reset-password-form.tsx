import { ArrowRight, ShieldAlert } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function ResetPasswordForm() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center space-y-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
          <ShieldAlert className="h-6 w-6 text-amber-500" />
        </div>
        <h2 className="font-semibold text-foreground text-xl">
          Reset links aren’t enabled yet
        </h2>
        <p className="text-muted-foreground text-sm">
          Your admin can reset your password or send you a new invite. If you
          need help, contact support.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-4 text-muted-foreground text-sm">
        Email{" "}
        <span className="font-medium text-foreground">support@drovi.ai</span>{" "}
        with your workspace name and we’ll assist you.
      </div>

      <Button className="w-full" onClick={() => navigate({ to: "/login" })}>
        Back to sign in
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
