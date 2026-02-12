import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@memorystack/ui-core/avatar";
import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@memorystack/ui-core/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@memorystack/ui-core/table";
import {
  Building2,
  CheckCircle2,
  Clock,
  Eye,
  Mail,
  MoreHorizontal,
  XCircle,
} from "lucide-react";

interface User {
  id: string;
  name: string;
  email: string;
  organization: string;
  status: "active" | "pending" | "inactive" | "churned";
  plan: string;
  source: string;
  createdAt: string;
  avatar?: string;
}

// Sample data
const recentUsers: User[] = [
  {
    id: "1",
    name: "Sarah Johnson",
    email: "sarah@techcorp.com",
    organization: "TechCorp Inc.",
    status: "active",
    plan: "Pro",
    source: "Organic",
    createdAt: "2024-06-28",
  },
  {
    id: "2",
    name: "Michael Chen",
    email: "m.chen@innovate.io",
    organization: "Innovate.io",
    status: "pending",
    plan: "Free",
    source: "Referral",
    createdAt: "2024-06-28",
  },
  {
    id: "3",
    name: "Emily Rodriguez",
    email: "emily@startupxyz.com",
    organization: "StartupXYZ",
    status: "active",
    plan: "Pro",
    source: "Google Ads",
    createdAt: "2024-06-27",
  },
  {
    id: "4",
    name: "David Kim",
    email: "david.kim@enterprise.co",
    organization: "Enterprise Co.",
    status: "active",
    plan: "Enterprise",
    source: "Sales",
    createdAt: "2024-06-27",
  },
  {
    id: "5",
    name: "Anna Martinez",
    email: "anna@globaltech.net",
    organization: "GlobalTech",
    status: "churned",
    plan: "Pro",
    source: "Organic",
    createdAt: "2024-06-26",
  },
  {
    id: "6",
    name: "James Wilson",
    email: "j.wilson@acme.com",
    organization: "Acme Corp",
    status: "pending",
    plan: "Free",
    source: "Referral",
    createdAt: "2024-06-26",
  },
  {
    id: "7",
    name: "Lisa Thompson",
    email: "lisa@digitalagency.com",
    organization: "Digital Agency",
    status: "active",
    plan: "Pro",
    source: "Organic",
    createdAt: "2024-06-25",
  },
];

function getStatusBadge(status: User["status"]) {
  switch (status) {
    case "pending":
      return (
        <Badge className="gap-1" variant="outline">
          <Clock className="h-3 w-3" />
          Pending
        </Badge>
      );
    case "inactive":
      return (
        <Badge className="gap-1" variant="secondary">
          <Clock className="h-3 w-3" />
          Inactive
        </Badge>
      );
    case "active":
      return (
        <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
          <CheckCircle2 className="h-3 w-3" />
          Active
        </Badge>
      );
    case "churned":
      return (
        <Badge className="gap-1" variant="destructive">
          <XCircle className="h-3 w-3" />
          Churned
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function RecentActivityTable() {
  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Recent Users</CardTitle>
          <CardDescription>
            Latest signups and their current status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead className="hidden md:table-cell">
                  Organization
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Plan</TableHead>
                <TableHead className="hidden lg:table-cell">Source</TableHead>
                <TableHead className="hidden lg:table-cell">Date</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarImage alt={user.name} src={user.avatar} />
                        <AvatarFallback className="text-xs">
                          {getInitials(user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium">{user.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {user.email}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {user.organization}
                    </div>
                  </TableCell>
                  <TableCell>{getStatusBadge(user.status)}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline">{user.plan}</Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <Badge variant="secondary">{user.source}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {new Date(user.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button className="h-8 w-8" size="icon" variant="ghost">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem>
                          <Eye className="mr-2 h-4 w-4" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Mail className="mr-2 h-4 w-4" />
                          Send Email
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Building2 className="mr-2 h-4 w-4" />
                          View Organization
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive">
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
