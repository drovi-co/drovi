// =============================================================================
// CUSTOM ROLES EDITOR PAGE
// =============================================================================
//
// Enterprise feature for creating and managing custom roles with granular permissions.
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  Edit2,
  MoreHorizontal,
  Plus,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/settings/roles")({
  component: CustomRolesPage,
});

// =============================================================================
// PERMISSION CATEGORIES
// =============================================================================

const PERMISSION_CATEGORIES = [
  {
    id: "inbox",
    label: "Inbox",
    permissions: [
      { key: "inbox:read", label: "View inbox" },
      { key: "inbox:write", label: "Reply to messages" },
      { key: "inbox:delete", label: "Delete messages" },
      { key: "inbox:assign", label: "Assign conversations" },
    ],
  },
  {
    id: "intelligence",
    label: "Intelligence",
    permissions: [
      { key: "commitments:read", label: "View commitments" },
      { key: "commitments:write", label: "Edit commitments" },
      { key: "commitments:delete", label: "Delete commitments" },
      { key: "decisions:read", label: "View decisions" },
      { key: "decisions:write", label: "Edit decisions" },
      { key: "decisions:delete", label: "Delete decisions" },
    ],
  },
  {
    id: "tasks",
    label: "Tasks",
    permissions: [
      { key: "tasks:read", label: "View tasks" },
      { key: "tasks:write", label: "Create/edit tasks" },
      { key: "tasks:delete", label: "Delete tasks" },
      { key: "tasks:assign", label: "Assign tasks" },
    ],
  },
  {
    id: "contacts",
    label: "Contacts",
    permissions: [
      { key: "contacts:read", label: "View contacts" },
      { key: "contacts:write", label: "Edit contacts" },
      { key: "contacts:delete", label: "Delete contacts" },
    ],
  },
  {
    id: "team",
    label: "Team Management",
    permissions: [
      { key: "team:invite", label: "Invite members" },
      { key: "team:remove", label: "Remove members" },
      { key: "team:change_role", label: "Change member roles" },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    permissions: [
      { key: "settings:read", label: "View settings" },
      { key: "settings:write", label: "Edit settings" },
      { key: "billing:read", label: "View billing" },
      { key: "billing:write", label: "Manage billing" },
      { key: "audit:read", label: "View audit logs" },
      { key: "integrations:connect", label: "Connect integrations" },
      { key: "integrations:disconnect", label: "Disconnect integrations" },
    ],
  },
];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function CustomRolesPage() {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const queryClient = useQueryClient();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(
    new Set()
  );

  // Fetch custom roles
  const { data: rolesData, isLoading } = useQuery({
    ...trpc.customRoles.list.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  // Create role mutation
  const createMutation = useMutation(
    trpc.customRoles.create.mutationOptions({
      onSuccess: () => {
        toast.success("Role created successfully");
        setCreateDialogOpen(false);
        resetForm();
        queryClient.invalidateQueries({ queryKey: ["customRoles", "list"] });
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create role");
      },
    })
  );

  // Delete role mutation
  const deleteMutation = useMutation(
    trpc.customRoles.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Role deleted");
        queryClient.invalidateQueries({ queryKey: ["customRoles", "list"] });
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete role");
      },
    })
  );

  const resetForm = () => {
    setNewRoleName("");
    setNewRoleDescription("");
    setSelectedPermissions(new Set());
  };

  const togglePermission = (key: string) => {
    const newSet = new Set(selectedPermissions);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    setSelectedPermissions(newSet);
  };

  const handleCreateRole = () => {
    if (!newRoleName.trim()) return;

    // Convert permissions set to object format
    const permissions: Record<string, boolean> = {};
    for (const perm of selectedPermissions) {
      permissions[perm] = true;
    }

    createMutation.mutate({
      organizationId,
      name: newRoleName.trim(),
      description: newRoleDescription.trim() || undefined,
      permissions,
    });
  };

  const handleDeleteRole = (roleId: string) => {
    deleteMutation.mutate({ organizationId, roleId });
  };

  const roles = rolesData?.roles ?? [];

  // Built-in roles
  const builtInRoles = [
    {
      name: "Owner",
      description: "Full access to everything",
      isBuiltIn: true,
      permissionCount: "All",
    },
    {
      name: "Admin",
      description: "Manage members and settings",
      isBuiltIn: true,
      permissionCount: "Admin",
    },
    {
      name: "Member",
      description: "Standard team member access",
      isBuiltIn: true,
      permissionCount: "Standard",
    },
    {
      name: "Viewer",
      description: "Read-only access",
      isBuiltIn: true,
      permissionCount: "Read-only",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl tracking-tight">Custom Roles</h1>
          <p className="text-muted-foreground">
            Create custom roles with granular permissions for your organization
          </p>
        </div>

        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Role
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Custom Role</DialogTitle>
              <DialogDescription>
                Define a new role with specific permissions
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="roleName">Role Name</Label>
                <Input
                  id="roleName"
                  placeholder="e.g., Support Agent, Sales Rep"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="roleDescription">Description (optional)</Label>
                <Textarea
                  id="roleDescription"
                  placeholder="What can this role do?"
                  value={newRoleDescription}
                  onChange={(e) => setNewRoleDescription(e.target.value)}
                />
              </div>

              <Separator />

              <div className="space-y-4">
                <Label>Permissions</Label>
                {PERMISSION_CATEGORIES.map((category) => (
                  <div key={category.id} className="space-y-2">
                    <h4 className="font-medium text-sm">{category.label}</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {category.permissions.map((perm) => (
                        <div
                          key={perm.key}
                          className="flex items-center space-x-2"
                        >
                          <Checkbox
                            id={perm.key}
                            checked={selectedPermissions.has(perm.key)}
                            onCheckedChange={() => togglePermission(perm.key)}
                          />
                          <label
                            htmlFor={perm.key}
                            className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                          >
                            {perm.label}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setCreateDialogOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateRole}
                disabled={!newRoleName.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Role"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Built-in Roles */}
      <Card>
        <CardHeader>
          <CardTitle>Built-in Roles</CardTitle>
          <CardDescription>
            Standard roles that come with every organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {builtInRoles.map((role) => (
              <div
                key={role.name}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{role.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {role.description}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary">{role.permissionCount}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Custom Roles */}
      <Card>
        <CardHeader>
          <CardTitle>Custom Roles</CardTitle>
          <CardDescription>
            Roles you've created for your organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border p-3 animate-pulse"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-5 w-5 rounded bg-muted" />
                    <div>
                      <div className="h-4 w-32 rounded bg-muted" />
                      <div className="mt-1 h-3 w-48 rounded bg-muted" />
                    </div>
                  </div>
                  <div className="h-6 w-16 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : roles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Shield className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="mb-2 font-semibold">No custom roles</h3>
              <p className="mb-4 text-muted-foreground text-sm">
                Create custom roles to fine-tune permissions for your team
              </p>
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Role
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              {roles.map((role) => (
                <div
                  key={role.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <Shield className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">{role.name}</p>
                      <p className="text-muted-foreground text-sm">
                        {role.description || "No description"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {Object.keys(role.permissions ?? {}).length} permissions
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Edit2 className="mr-2 h-4 w-4" />
                          Edit Role
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-500"
                          onClick={() => handleDeleteRole(role.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete Role
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
