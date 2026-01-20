import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTRPC } from "@/utils/trpc";

interface WaitlistDialogProps {
  children: React.ReactNode;
}

export function WaitlistDialog({ children }: WaitlistDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    company: "",
    role: "",
    useCase: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const trpc = useTRPC();

  const submitMutation = useMutation(
    trpc.waitlist.submit.mutationOptions({
      onSuccess: () => {
        setSubmitted(true);
      },
      onError: (error) => {
        setErrors({ submit: error.message });
      },
    })
  );

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.email) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email";
    }

    if (!formData.name || formData.name.length < 2) {
      newErrors.name = "Name must be at least 2 characters";
    }

    if (formData.useCase && formData.useCase.length > 1000) {
      newErrors.useCase = "Use case must be under 1000 characters";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    submitMutation.mutate({
      email: formData.email,
      name: formData.name,
      company: formData.company || undefined,
      role: formData.role || undefined,
      useCase: formData.useCase || undefined,
    });
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    // Reset form when dialog closes
    if (!newOpen) {
      setTimeout(() => {
        setSubmitted(false);
        setFormData({
          email: "",
          name: "",
          company: "",
          role: "",
          useCase: "",
        });
        setErrors({});
      }, 300);
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-[520px]">
        {submitted ? (
          // Success state
          <div className="flex flex-col items-center py-8 text-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">You're on the list!</DialogTitle>
              <DialogDescription className="max-w-[360px] text-center">
                We've received your application. We'll review it and send you an
                invite code when you're approved.
              </DialogDescription>
            </DialogHeader>
            <Button
              className="mt-6"
              onClick={() => setOpen(false)}
              variant="secondary"
            >
              Got it
            </Button>
          </div>
        ) : (
          // Form state
          <>
            <DialogHeader>
              <DialogTitle>Request Access</DialogTitle>
              <DialogDescription>
                Join the waitlist for early access to Drovi. We'll review your
                application and send you an invite code.
              </DialogDescription>
            </DialogHeader>

            <form className="mt-2 space-y-4" onSubmit={handleSubmit}>
              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="email">
                  Email <span className="text-destructive">*</span>
                </Label>
                <Input
                  aria-invalid={!!errors.email}
                  id="email"
                  name="email"
                  onChange={handleChange}
                  placeholder="you@company.com"
                  type="email"
                  value={formData.email}
                />
                {errors.email && (
                  <p className="text-[12px] text-destructive">{errors.email}</p>
                )}
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  aria-invalid={!!errors.name}
                  id="name"
                  name="name"
                  onChange={handleChange}
                  placeholder="Your full name"
                  value={formData.name}
                />
                {errors.name && (
                  <p className="text-[12px] text-destructive">{errors.name}</p>
                )}
              </div>

              {/* Company & Role row */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="company">Company</Label>
                  <Input
                    id="company"
                    name="company"
                    onChange={handleChange}
                    placeholder="Your company"
                    value={formData.company}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="role">Role</Label>
                  <Input
                    id="role"
                    name="role"
                    onChange={handleChange}
                    placeholder="Your role"
                    value={formData.role}
                  />
                </div>
              </div>

              {/* Use Case */}
              <div className="space-y-1.5">
                <Label htmlFor="useCase">How will you use Drovi?</Label>
                <Textarea
                  aria-invalid={!!errors.useCase}
                  className="min-h-[100px] resize-y"
                  id="useCase"
                  name="useCase"
                  onChange={handleChange}
                  placeholder="Tell us about your workflow and what problems you're hoping to solve..."
                  value={formData.useCase}
                />
                {errors.useCase && (
                  <p className="text-[12px] text-destructive">
                    {errors.useCase}
                  </p>
                )}
              </div>

              {/* Submit error */}
              {errors.submit && (
                <p className="text-[13px] text-destructive">{errors.submit}</p>
              )}

              {/* Submit button */}
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  onClick={() => setOpen(false)}
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button disabled={submitMutation.isPending} type="submit">
                  {submitMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Request Access"
                  )}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
