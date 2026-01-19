"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";
import { AssigneeIcon } from "./assignee-icon";
import { StatusIcon, type Status } from "./status-icon";
import { PriorityIcon, type Priority } from "./priority-icon";
import { LabelDot, type LabelType } from "./label-dot";

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

function ActivityAvatar({ user, showOnlineStatus = true }: ActivityAvatarProps) {
  return (
    <div className="relative shrink-0">
      <AssigneeIcon
        name={user.name}
        email={user.email}
        imageUrl={user.imageUrl}
        size="xs"
      />
      {showOnlineStatus && user.isOnline && (
        <div className="absolute -bottom-0.5 -right-0.5 size-[7px] rounded-full bg-[#4CB782] border border-[#191A23]" />
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
          <span className="text-[#858699]">created the issue.</span>
        );

      case "status_change":
        return (
          <>
            <span className="text-[#858699]">changed status to </span>
            <span className="inline-flex items-center gap-1">
              <StatusIcon status={activity.toStatus} size="xs" />
              <span className="text-[#EEEFFC]">
                {activity.toStatus.replace("_", " ")}
              </span>
            </span>
          </>
        );

      case "priority_change":
        return (
          <>
            <span className="text-[#858699]">set priority to </span>
            <span className="inline-flex items-center gap-1">
              <PriorityIcon priority={activity.toPriority} size="xs" />
              <span className="text-[#EEEFFC]">{activity.toPriority}</span>
            </span>
          </>
        );

      case "self_assigned":
        return <span className="text-[#858699]">self-assigned this issue.</span>;

      case "assigned":
        return (
          <>
            <span className="text-[#858699]">assigned </span>
            <span className="text-[#EEEFFC]">
              {activity.assignee?.name || "someone"}
            </span>
          </>
        );

      case "unassigned":
        return (
          <>
            <span className="text-[#858699]">unassigned </span>
            <span className="text-[#EEEFFC]">
              {activity.assignee?.name || "someone"}
            </span>
          </>
        );

      case "labels_added":
        return (
          <>
            <span className="text-[#858699]">added labels </span>
            <span className="inline-flex items-center gap-1 flex-wrap">
              {activity.labels.map((label, idx) => (
                <span key={label.name} className="inline-flex items-center gap-1">
                  <LabelDot labelType={label.type} color={label.color} size="xs" />
                  <span className="text-[#EEEFFC]">{label.name}</span>
                  {idx < activity.labels.length - 1 && (
                    <span className="text-[#858699]">, </span>
                  )}
                </span>
              ))}
            </span>
          </>
        );

      case "labels_removed":
        return (
          <>
            <span className="text-[#858699]">removed labels </span>
            <span className="inline-flex items-center gap-1 flex-wrap">
              {activity.labels.map((label, idx) => (
                <span key={label.name} className="inline-flex items-center gap-1">
                  <LabelDot labelType={label.type} color={label.color} size="xs" />
                  <span className="text-[#EEEFFC]">{label.name}</span>
                  {idx < activity.labels.length - 1 && (
                    <span className="text-[#858699]">, </span>
                  )}
                </span>
              ))}
            </span>
          </>
        );

      case "description_updated":
        return <span className="text-[#858699]">updated the description.</span>;

      case "comment":
        return (
          <div className="mt-1">
            <p className="text-[13px] text-foreground whitespace-pre-wrap">
              {activity.content}
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex gap-2 relative">
      {/* Timeline line */}
      {showTimeline && !isLast && (
        <div className="absolute left-[7px] top-[20px] bottom-0 w-px bg-[#191A23]" />
      )}

      {/* Avatar */}
      <div className="bg-[#191A23] py-[6px] relative z-10">
        <ActivityAvatar user={activity.user} />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-wrap items-start gap-2 text-[12px] font-medium leading-normal pt-[6px]">
        <span className="text-[#EEEFFC]">{activity.user.name}</span>
        {renderContent()}
        <span className="text-[#858699]">{activity.timestamp}</span>
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
          key={activity.id}
          activity={activity}
          isLast={index === activities.length - 1}
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
        "text-[13px] font-medium text-[#858699]",
        className
      )}
      data-slot="activity-header"
      {...props}
    >
      <span>{title}</span>
      {count !== undefined && (
        <span className="text-[#4C4F6B]">({count})</span>
      )}
    </div>
  );
}

/**
 * Subscriber Button - for activity subscriptions
 */
interface SubscriberButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
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
      type="button"
      className={cn(
        "flex items-center gap-1",
        "px-2 py-1 rounded-[4px]",
        "text-[12px] text-[#858699]",
        "transition-colors duration-150",
        "hover:bg-muted hover:text-foreground",
        isSubscribed && "text-[#EEEFFC]",
        className
      )}
      {...props}
    >
      {subscribers.length > 0 && (
        <div className="flex -space-x-1">
          {subscribers.slice(0, 3).map((user, idx) => (
            <AssigneeIcon
              key={user.email || user.name}
              name={user.name}
              imageUrl={user.imageUrl}
              size="xs"
              className="ring-1 ring-background"
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
