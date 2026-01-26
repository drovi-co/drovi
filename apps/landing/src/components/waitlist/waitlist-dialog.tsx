"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
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
import { useTRPC } from "@/lib/trpc";

interface WaitlistDialogProps {
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function WaitlistDialog({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: WaitlistDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    company: "",
    role: "",
    useCase: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen =
    isControlled && controlledOnOpenChange
      ? controlledOnOpenChange
      : setInternalOpen;

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
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

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
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-[520px]">
        {submitted ? (
          <div className="flex flex-col items-center py-4 text-center sm:py-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 sm:mb-6 sm:h-16 sm:w-16">
              <CheckCircle2 className="h-6 w-6 text-emerald-500 sm:h-8 sm:w-8" />
            </div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-lg sm:text-xl">
                You're on the list!
              </DialogTitle>
              <DialogDescription className="max-w-[360px] text-center text-[13px] sm:text-sm">
                We've received your application. We'll review it and send you an
                invite code when you're approved.
              </DialogDescription>
            </DialogHeader>
            <Button
              className="mt-4 sm:mt-6"
              onClick={() => setOpen(false)}
              variant="ghost"
            >
              Got it
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg sm:text-xl">
                Request Access
              </DialogTitle>
              <DialogDescription className="text-[13px] sm:text-sm">
                Join the waitlist for early access to Drovi. We'll review your
                application and send you an invite code.
              </DialogDescription>
            </DialogHeader>

            <form
              className="mt-2 space-y-3 sm:space-y-4"
              onSubmit={handleSubmit}
            >
              <div className="space-y-1.5">
                <Label className="text-[13px] sm:text-sm" htmlFor="email">
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

              <div className="space-y-1.5">
                <Label className="text-[13px] sm:text-sm" htmlFor="name">
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[13px] sm:text-sm" htmlFor="company">
                    Company
                  </Label>
                  <Input
                    id="company"
                    name="company"
                    onChange={handleChange}
                    placeholder="Your company"
                    value={formData.company}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] sm:text-sm" htmlFor="role">
                    Role
                  </Label>
                  <Input
                    id="role"
                    name="role"
                    onChange={handleChange}
                    placeholder="Your role"
                    value={formData.role}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[13px] sm:text-sm" htmlFor="useCase">
                  How will you use Drovi?
                </Label>
                <Textarea
                  aria-invalid={!!errors.useCase}
                  className="min-h-[80px] resize-y sm:min-h-[100px]"
                  id="useCase"
                  name="useCase"
                  onChange={handleChange}
                  placeholder="Tell us about your workflow..."
                  value={formData.useCase}
                />
                {errors.useCase && (
                  <p className="text-[12px] text-destructive">
                    {errors.useCase}
                  </p>
                )}
              </div>

              {errors.submit && (
                <p className="text-[13px] text-destructive">{errors.submit}</p>
              )}

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-3">
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => setOpen(false)}
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  disabled={submitMutation.isPending}
                  type="submit"
                >
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
