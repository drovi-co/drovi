import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@memorystack/ui-core/breadcrumb";
import { Separator } from "@memorystack/ui-core/separator";
import { SidebarTrigger } from "@memorystack/ui-core/sidebar";
import { ModeToggle } from "@/components/mode-toggle";

interface BreadcrumbItemData {
  label: string;
  href?: string;
}

interface SiteHeaderProps {
  breadcrumbs?: BreadcrumbItemData[];
}

export function SiteHeader({ breadcrumbs = [] }: SiteHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          className="mr-2 data-[orientation=vertical]:h-4"
          orientation="vertical"
        />
        {breadcrumbs.length > 0 && (
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((item, index) => (
                <span className="contents" key={item.label}>
                  <BreadcrumbItem>
                    {index < breadcrumbs.length - 1 ? (
                      <BreadcrumbLink href={item.href ?? "#"}>
                        {item.label}
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{item.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {index < breadcrumbs.length - 1 && (
                    <BreadcrumbSeparator className="hidden md:block" />
                  )}
                </span>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2 px-4">
        <ModeToggle />
      </div>
    </header>
  );
}
