import * as React from "react";

import { cn } from "@/lib/utils/cn";
import { Label } from "@/components/ui/label";

// Label + control + error/help slot, composed around the app's existing
// `<label className="block"><span>…</span><input/></label>` pattern (see the
// pre-V5 webhook-create-form / threshold-picker inputs) so every form field
// site gets the same vertical rhythm and the same error/help typography for
// free. Deliberately does NOT auto-wire aria-describedby/id via cloning —
// callers pass `labelFor`/`errorId`/`helpId` explicitly, which keeps the
// contract simple and fully typed (no `any`-cast children).
interface FieldProps extends React.ComponentProps<"div"> {
  label?: React.ReactNode;
  labelFor?: string;
  required?: boolean;
  /** Field-scoped validation error. Rendered with role="alert" in
   *  st-critical-text — pass this instead of a page-level error string when
   *  the failure is specific to this control. */
  error?: React.ReactNode;
  errorId?: string;
  help?: React.ReactNode;
  helpId?: string;
}

function Field({
  label,
  labelFor,
  required,
  error,
  errorId,
  help,
  helpId,
  className,
  children,
  ...props
}: FieldProps) {
  return (
    <div data-slot="field" className={cn("space-y-1.5", className)} {...props}>
      {label && (
        <Label htmlFor={labelFor}>
          {label}
          {required && (
            <span aria-hidden className="ml-1 text-st-depeg-text">
              *
            </span>
          )}
        </Label>
      )}
      {children}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="font-mono text-[11px] leading-[1.5] text-st-depeg-text"
        >
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="text-[11px] leading-[1.5] text-text-caption">
          {help}
        </p>
      ) : null}
    </div>
  );
}

export { Field };
