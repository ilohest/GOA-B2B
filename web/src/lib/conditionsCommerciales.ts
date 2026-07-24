import type { ClientEasybeer, RemiseCibleeClient } from "@/lib/types";
import { prixFr } from "@/lib/format";

export type EtatAvantage = "actif" | "expire-bientot" | "a-venir" | "expire";

export function formatRemiseCommerciale(
  remise: string | null | undefined,
): string | null {
  if (!remise?.trim()) return null;
  const texte = remise.trim();
  if (texte.includes("%")) return texte.replace(/\s*%\s*$/, " %");
  if (texte.includes("€")) return texte;
  const valeur = Number.parseFloat(texte.replace(",", "."));
  return Number.isFinite(valeur) ? prixFr(valeur) : texte;
}

function timestamp(date: string | null | undefined) {
  if (!date) return null;
  const valeur = new Date(date).getTime();
  return Number.isNaN(valeur) ? null : valeur;
}

export function etatAvantage(
  remise: Pick<RemiseCibleeClient, "dateDebut" | "dateFin">,
  maintenant = Date.now(),
): EtatAvantage {
  const debut = timestamp(remise.dateDebut);
  const fin = timestamp(remise.dateFin);
  if (debut != null && debut > maintenant) return "a-venir";
  if (fin != null && fin < maintenant) return "expire";
  if (fin != null && fin - maintenant <= 14 * 24 * 60 * 60 * 1000)
    return "expire-bientot";
  return "actif";
}

export function remisesProduitVisibles(
  client: ClientEasybeer | null | undefined,
) {
  const remises = (client?.remisesCiblees ?? []).filter(
    (remise) =>
      formatRemiseCommerciale(remise.remise) != null &&
      etatAvantage(remise) !== "expire",
  );

  return remises.filter((remise) => {
    if (remise.scope !== "segment" || !remiseActuellementApplicable(remise))
      return true;

    return !remises.some(
      (prioritaire) =>
        prioritaire.scope !== "segment" &&
        remiseActuellementApplicable(prioritaire) &&
        remiseIndividuelleCouvre(prioritaire, remise),
    );
  });
}

function remiseActuellementApplicable(remise: RemiseCibleeClient) {
  const etat = etatAvantage(remise);
  return etat === "actif" || etat === "expire-bientot";
}

function texteComparable(valeur: string | null | undefined) {
  return valeur?.trim().toLocaleLowerCase("fr") || null;
}

function dimensionCouverte(
  idPrioritaire: number | null | undefined,
  textePrioritaire: string | null | undefined,
  idCandidate: number | null | undefined,
  texteCandidate: string | null | undefined,
) {
  if (idPrioritaire != null) return idCandidate === idPrioritaire;
  const prioritaire = texteComparable(textePrioritaire);
  if (!prioritaire) return true;
  return texteComparable(texteCandidate) === prioritaire;
}

/**
 * Une remise individuelle masque une remise de catégorie uniquement si elle
 * couvre entièrement la même cible et devient applicable au plus tard à la
 * même quantité. Les règles partiellement complémentaires restent visibles.
 */
function remiseIndividuelleCouvre(
  prioritaire: RemiseCibleeClient,
  candidate: RemiseCibleeClient,
) {
  const ciblePrioritaireRenseignee =
    prioritaire.idStockBouteille != null ||
    prioritaire.idProduit != null ||
    prioritaire.idContenant != null ||
    prioritaire.idLot != null ||
    texteComparable(prioritaire.produit) != null ||
    texteComparable(prioritaire.contenant) != null ||
    texteComparable(prioritaire.packaging) != null;
  if (!ciblePrioritaireRenseignee) return false;

  return (
    dimensionCouverte(
      prioritaire.idStockBouteille,
      null,
      candidate.idStockBouteille,
      null,
    ) &&
    dimensionCouverte(
      prioritaire.idProduit,
      prioritaire.produit,
      candidate.idProduit,
      candidate.produit,
    ) &&
    dimensionCouverte(
      prioritaire.idContenant,
      prioritaire.contenant,
      candidate.idContenant,
      candidate.contenant,
    ) &&
    dimensionCouverte(
      prioritaire.idLot,
      prioritaire.packaging,
      candidate.idLot,
      candidate.packaging,
    ) &&
    (prioritaire.quantite ?? 0) <= (candidate.quantite ?? 0)
  );
}

export function libelleOrigineRemise(
  scope: string | null | undefined,
  scopeLibelle: string | null | undefined,
) {
  if (scope === "segment") {
    return scopeLibelle
      ? `Avantage réservé aux clients ${scopeLibelle}`
      : "Avantage lié à votre catégorie professionnelle";
  }
  return "Tarif négocié pour votre établissement";
}

export function resumeConditionsCommerciales(
  client: ClientEasybeer | null | undefined,
) {
  if (!client) return null;
  const remiseCommande = formatRemiseCommerciale(client.remise);
  const remisesProduit = remisesProduitVisibles(client);
  const minimum = client.minimumCommande ?? null;
  if (!remiseCommande && !remisesProduit.length) return null;

  const elements: string[] = [];
  if (remiseCommande) elements.push(`${remiseCommande} sur vos commandes`);
  if (remisesProduit.length) {
    elements.push(
      `${remisesProduit.length} remise${remisesProduit.length > 1 ? "s" : ""} produit`,
    );
  }
  return {
    remiseCommande,
    nbRemisesProduit: remisesProduit.length,
    minimum,
    libelle: elements.join(" · "),
  };
}
