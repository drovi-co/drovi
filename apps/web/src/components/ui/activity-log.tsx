"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";
import { AssigneeIcon } from "./assignee-icon";
import { LabelDot, type LabelType } from "./label-dot";
import { type Priority, PriorityIcon } from "./priority-icon";
import { type Status, StatusIcon } from "./status-icon";

/**
 * Linear-style Activity Log component
 *
 * Features:
 * - Various activity types: created, status change, priority, assignee, labels
 * - User avatar with online status indicator
 * - Timestamp display
 * - Timeline connector line
 */

type ActivityType =
  | "created"
  | "status_change"
  | "priority_change"
  | "assigned"
  | "self_assigned"
  | "unassigned"
  | "labels_added"
  | "labels_removed"
  | "description_updated"
  | "comment";

interface ActivityUser {
  name: string;
  email?: string;
  imageUrl?: string;
  isOnline?: boolean;
}

interface BaseActivity {
  id: string;
  type: ActivityType;
  user: ActivityUser;
  timestamp: string;
}

interface CreatedActivity extends BaseActivity {
  type: "created";
}

interface StatusChangeActivity extends BaseActivity {
  type: "status_change";
  fromStatus?: Status;
  toStatus: Status;
}

interface PriorityChangeActivity extends BaseActivity {
  type: "priority_change";
  fromPriority?: Priority;
  toPriority: Priority;
}

interface AssignedActivity extends BaseActivity {
  type: "assigned" | "self_assigned" | "unassigned";
  assignee?: ActivityUser;
}

interface LabelsActivity extends BaseActivity {
  type: "labels_added" | "labels_removed";
  labels: Array<{ type?: LabelType; name: string; color?: string }>;
}

interface DescriptionActivity extends BaseActivity {
  type: "description_updated";
}

interface CommentActivity extends BaseActivity {
  type: "comment";
  content: string;
}

type Activity =
  | CreatedActivity
  | StatusChangeActivity
  | PriorityChangeActivity
  | AssignedActivity
  | LabelsActivity
  | DescriptionActivity
  | CommentActivity;

interface ActivityAvatarProps {
  user: ActivityUser;
  showOnlineStatus?: boolean;
}

function ActivityAvatar({
  user,
  showOnlineStatus = true,
}: ActivityAvatarProps) {
  return (
    <div className="relative shrink-0">
      <AssigneeIcon
        email={user.email}
        imageUrl={user.imageUrl}
        name={user.name}
        size="xs"
      />
      {showOnlineStatus && user.isOnline && (
        <div className="absolute -right-0.5 -bottom-0.5 size-[7px] rounded-full border border-border bg-[#059669]" />
      )}
    </div>
  );
}

interface ActivityEntryProps {
  activity: Activity;
  showTimeline?: boolean;
  isLast?: boolean;
}

function ActivityEntry({
  activity,
  showTimeline = true,
  isLast = false,
}: ActivityEntryProps) {
  const renderContent = () => {
    switch (activity.type) {
      case "created":
        return (
          <span className="text-muted-foreground">created the issue.</span>
        );

      case "status_change":
        return (
          <>
            <span className="text-muted-foreground">changed status to </span>
            <span className="inline-flex items-center gap-1">
              <StatusIcon size="xs" status={activity.toStatus} />
              <span className="text-foreground">
                {activity.toStatus.replace("_", " ")}
              </span>
            </span>
          </>
        );

      case "priority_change":
        return (
          <>
            <span className="text-muted-foreground">set priority to </span>
            <span className="inline-flex items-center gap-1">
              <PriorityIcon priority={activity.toPriority} size="xs" />
              <span className="text-foreground">{activity.toPriority}</span>
            </span>
          </>
        );

      case "self_assigned":
        return (
          <span className="text-muted-foreground">
            self-assigned this issue.
          </span>
        );

      case "assigned":
        return (
          <>
            <span className="text-muted-foreground">assigned </span>
            <span className="text-foreground">
              {activity.assignee?.name || "someone"}
            </span>
          </>
        );

      case "unassigned":
        return (
          <>
            <span className="text-muted-foreground">unassigned </span>
            <span className="text-foreground">
              {activity.assignee?.name || "someone"}
            </span>
          </>
        );

      case "labels_added":
        return (
          <>
            <span className="text-muted-foreground">added labels </span>
            <span className="inline-flex flex-wrap items-center gap-1">
              {activity.labels.map((label, idx) => (
                <span
                  className="inline-flex items-center gap-1"
                  key={label.name}
                >
                  <LabelDot
                    color={label.color}
                    labelType={label.type}
                    size="xs"
                  />
                  <span className="text-foreground">{label.name}</span>
                  {idx < activity.labels.length - 1 && (
                    <span className="text-muted-foreground">, </span>
                  )}
                </span>
              ))}
            </span>
          </>
        );

      case "labels_removed":
        return (
          <>
            <span className="text-muted-foreground">removed labels </span>
            <span className="inline-flex flex-wrap items-center gap-1">
              {activity.labels.map((label, idx) => (
                <span
                  className="inline-flex items-center gap-1"
                  key={label.name}
                >
                  <LabelDot
                    color={label.color}
                    labelType={label.type}
                    size="xs"
                  />
                  <span className="text-foreground">{label.name}</span>
                  {idx < activity.labels.length - 1 && (
                    <span className="text-muted-foreground">, </span>
                  )}
                </span>
              ))}
            </span>
          </>
        );

      case "description_updated":
        return (
          <span className="text-muted-foreground">
            updated the description.
          </span>
        );

      case "comment":
        return (
          <div className="mt-1">
            <p className="whitespace-pre-wrap text-[13px] text-foreground">
              {activity.content}
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="relative flex gap-2">
      {/* Timeline line */}
      {showTimeline && !isLast && (
        <div className="absolute top-[20px] bottom-0 left-[7px] w-px bg-background" />
      )}

      {/* Avatar */}
      <div className="relative z-10 bg-background py-[6px]">
        <ActivityAvatar user={activity.user} />
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-wrap items-start gap-2 pt-[6px] font-medium text-[12px] leading-normal">
        <span className="text-foreground">{activity.user.name}</span>
        {renderContent()}
        <span className="text-muted-foreground">{activity.timestamp}</span>
      </div>
    </div>
  );
}

interface ActivityLogProps extends React.HTMLAttributes<HTMLDivElement> {
  activities: Activity[];
}

function ActivityLog({ className, activities, ...props }: ActivityLogProps) {
  return (
    <div
      className={cn("flex flex-col", className)}
      data-slot="activity-log"
      {...props}
    >
      {activities.map((activity, index) => (
        <ActivityEntry
          activity={activity}
          isLast={index === activities.length - 1}
          key={activity.id}
        />
      ))}
    </div>
  );
}

/**
 * Activity Header - section header for activity/comments
 */
interface ActivityHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  count?: number;
}

function ActivityHeader({
  className,
  title,
  count,
  ...props
}: ActivityHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 py-2",
        "font-medium text-[13px] text-muted-foreground",
        className
      )}
      data-slot="activity-header"
      {...props}
    >
      <span>{title}</span>
      {count !== undefined && (
        <span className="text-muted-foreground">({count})</span>
      )}
    </div>
  );
}

/**
 * Subscriber Button - for activity subscriptions
 */
interface SubscriberButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  subscribers?: ActivityUser[];
  isSubscribed?: boolean;
}

function SubscriberButton({
  className,
  subscribers = [],
  isSubscribed = false,
  ...props
}: SubscriberButtonProps) {
  return (
    <button
      className={cn(
        "flex items-center gap-1",
        "rounded-[4px] px-2 py-1",
        "text-[12px] text-muted-foreground",
        "transition-colors duration-150",
        "hover:bg-muted hover:text-foreground",
        isSubscribed && "text-foreground",
        className
      )}
      type="button"
      {...props}
    >
      {subscribers.length > 0 && (
        <div className="flex -space-x-1">
          {subscribers.slice(0, 3).map((user, _idx) => (
            <AssigneeIcon
              className="ring-1 ring-background"
              imageUrl={user.imageUrl}
              key={user.email || user.name}
              name={user.name}
              size="xs"
            />
          ))}
        </div>
      )}
      <span>{subscribers.length || "Subscribe"}</span>
    </button>
  );
}

export {
  ActivityLog,
  ActivityEntry,
  ActivityHeader,
  ActivityAvatar,
  SubscriberButton,
  type Activity,
  type ActivityType,
  type ActivityUser,
};
