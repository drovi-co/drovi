import { ErrorBoundary as SentryErrorBoundary } from "@sentry/react";
import { AlertTriangle, Home, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface FallbackProps {
  error: Error;
  resetError: () => void;
}

function ErrorFallback({ error, resetError }: FallbackProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            An unexpected error occurred. Our team has been notified.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {process.env.NODE_ENV === "development" && (
            <div className="rounded-md bg-muted p-3">
              <p className="font-medium text-muted-foreground text-sm">
                Error details:
              </p>
              <p className="mt-1 text-destructive text-sm">{error.message}</p>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" onClick={resetError} variant="outline">
              <RefreshCcw className="mr-2 h-4 w-4" />
              Try again
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                window.location.href = "/";
              }}
            >
              <Home className="mr-2 h-4 w-4" />
              Go home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export function ErrorBoundary({ children }: ErrorBoundaryProps) {
  return (
    <SentryErrorBoundary
      fallback={({ error, resetError }) => (
        <ErrorFallback
          error={error instanceof Error ? error : new Error(String(error))}
          resetError={resetError}
        />
      )}
      onError={(error, componentStack) => {
        if (import.meta.env.DEV) {
          console.error("Error caught by boundary:", error, componentStack);
        }
      }}
    >
      {/* @ts-expect-error - React types version conflict in monorepo */}
      {children}
    </SentryErrorBoundary>
  );
}

export default ErrorBoundary;
