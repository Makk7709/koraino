import type { Approval, Channel, FactCheck } from "@/lib/api/types";
import { sha256Hex } from "./sha256";

export const MODIFIED_AFTER_APPROVAL = "Contenu modifié après approbation";

const CHANNEL_LABEL: Record<Channel, string> = {
  wordpress: "WordPress",
  linkedin: "LinkedIn",
  newsletter: "newsletter",
};

/** Toute modification du contenu invalide les approbations encore valides. */
export function invalidateApprovals(approvals: Approval[], at: string, reason: string): Approval[] {
  return approvals.map((a) =>
    a.valid ? { ...a, valid: false, invalidatedAt: at, invalidatedReason: reason } : a,
  );
}

export function invalidateApproval(
  approval: Approval | null,
  at: string,
  reason: string,
): Approval | null {
  if (!approval || !approval.valid) return approval;
  return { ...approval, valid: false, invalidatedAt: at, invalidatedReason: reason };
}

export function unresolvedContradictions(factChecks: FactCheck[]): FactCheck[] {
  return factChecks.filter((f) => f.status === "contradictoire");
}

/** Clé d'idempotence contenu + version + canal (sha-256). */
export function idempotencyKey(contentId: string, version: number, channel: Channel): string {
  return sha256Hex(`${contentId}:${version}:${channel}`);
}

export type PublishCheck =
  { ok: true; approval: Approval } | { ok: false; code: string; message: string };

/**
 * Contrôle effectué juste avant l'envoi : approbation valide pour CE canal et CETTE version,
 * aucune contradiction non résolue.
 */
export function checkPublishable(input: {
  approvals: Approval[];
  channel: Channel;
  version: number;
  factChecks?: FactCheck[];
}): PublishCheck {
  const { approvals, channel, version } = input;
  const contradictions = unresolvedContradictions(input.factChecks ?? []);
  if (contradictions.length > 0) {
    return {
      ok: false,
      code: "contradiction_unresolved",
      message: `Envoi bloqué : ${contradictions.length} contradiction(s) non résolue(s) dans le dossier factuel.`,
    };
  }
  const valid = approvals.filter((a) => a.valid);
  const match = valid.find((a) => a.channel === channel && a.version === version);
  if (match) return { ok: true, approval: match };

  const sameChannelOtherVersion = valid.find((a) => a.channel === channel);
  if (sameChannelOtherVersion) {
    return {
      ok: false,
      code: "approval_version_mismatch",
      message: `Envoi bloqué : l'approbation porte sur la version ${sameChannelOtherVersion.version}, la version courante est la ${version}.`,
    };
  }
  const otherChannel = valid.find((a) => a.version === version);
  if (otherChannel) {
    return {
      ok: false,
      code: "approval_wrong_channel",
      message: `Envoi bloqué : la version ${version} est approuvée pour ${CHANNEL_LABEL[otherChannel.channel]}, pas pour ${CHANNEL_LABEL[channel]}.`,
    };
  }
  const invalidated = [...approvals]
    .reverse()
    .find((a) => !a.valid && a.channel === channel && a.invalidatedReason);
  if (invalidated) {
    return {
      ok: false,
      code: "approval_invalidated",
      message: `Envoi bloqué : l'approbation de la version ${invalidated.version} a été invalidée (${invalidated.invalidatedReason}). Une nouvelle approbation est requise.`,
    };
  }
  return {
    ok: false,
    code: "approval_missing",
    message: `Envoi bloqué : aucune approbation valide pour ${CHANNEL_LABEL[channel]} sur la version ${version}.`,
  };
}

export function channelLabel(channel: Channel): string {
  return CHANNEL_LABEL[channel];
}
