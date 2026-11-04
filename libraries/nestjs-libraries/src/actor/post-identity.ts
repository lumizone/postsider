import { ActorView } from './post-actor';
import { ProvenanceField, provenanceView } from './post-provenance';

export type PostIdentity = {
  actor: { createdBy: ActorView | null; lastModifiedBy: ActorView | null };
  provenance: Record<ProvenanceField, string | null>;
};

export function emptyPostIdentity(): PostIdentity {
  return {
    actor: { createdBy: null, lastModifiedBy: null },
    provenance: provenanceView(null),
  };
}
