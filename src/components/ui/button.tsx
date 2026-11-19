import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("button", {
  variants: {
    variant: { default: "primary", outline: "", destructive: "danger" },
    size: { default: "", icon: "icon-btn" },
  },
  defaultVariants: { variant: "outline", size: "default" },
});

export function Button({
  className, variant, size, asChild = false, type = "button", ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return <Component data-slot="button" className={cn(buttonVariants({ variant, size }), className)} type={asChild ? undefined : type} {...props} />;
}
