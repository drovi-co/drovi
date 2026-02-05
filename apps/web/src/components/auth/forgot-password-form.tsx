import { ArrowLeft, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ForgotPasswordFormProps {
  onBack: () => void;
}

export function ForgotPasswordForm({ onBack }: ForgotPasswordFormProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center space-y-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <KeyRound className="h-6 w-6 text-primary" />
        </div>
        <h2 className="font-semibold text-foreground text-xl">
          Password resets are managed by your admin
        </h2>
        <p className="text-muted-foreground text-sm">
          For pilot workspaces, administrators handle password resets directly.
          Reach out to your org admin or support to regain access.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-4 text-muted-foreground text-sm">
        Need help? Email{" "}
        <span className="font-medium text-foreground">
          support@drovi.ai
        </span>{" "}
        and include your workspace name.
      </div>

      <Button className="w-full" onClick={onBack} variant="outline">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to sign in
      </Button>
    </div>
  );
}
