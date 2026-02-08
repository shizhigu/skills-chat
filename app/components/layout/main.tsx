import { cn } from "~/lib/utils";

interface MainProps extends React.HTMLAttributes<HTMLElement> {
  fixed?: boolean;
}

export function Main({ fixed, className, children, ...props }: MainProps) {
  return (
    <main
      className={cn(
        "flex flex-1 flex-col",
        fixed && "overflow-hidden",
        className
      )}
      {...props}
    >
      {children}
    </main>
  );
}
