import type { AuditEvent, Notification } from "@/lib/api/types";
import type { Ctx } from "../context";
import type { Repository } from "../store/repository";

/** Journalise une décision (qui, quoi, sur quoi, quand). */
export async function audit(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
  action: string,
  entity: AuditEvent["entity"],
  entityId: string,
  details: string,
  actor?: string,
): Promise<AuditEvent> {
  const event: AuditEvent = {
    id: ctx.repo.nextId("aud"),
    at: ctx.now.toISOString(),
    actor: actor ?? ctx.user.name,
    action,
    entity,
    entityId,
    details,
  };
  await ctx.repo.audit.insert(event);
  return event;
}

export async function notify(
  repo: Repository,
  now: Date,
  n: Pick<Notification, "kind" | "title" | "body" | "link">,
): Promise<Notification> {
  const notification: Notification = {
    id: repo.nextId("notif"),
    at: now.toISOString(),
    read: false,
    ...n,
  };
  await repo.notifications.insert(notification);
  return notification;
}
