export interface LigneConditionnementPostal {
  quantite: number;
  contenant?: string | null;
  packaging?: string | null;
}

export interface GroupeConditionnementPostalInvalide {
  contenant: string;
  packaging: string;
  quantite: number;
  multiple: number;
  manque: number;
}

function multiplePourContenant(contenant: string) {
  if (/0[.,]?35\s*c?l/i.test(contenant)) return 3;
  if (/\b1\s*l\b/i.test(contenant)) return 2;
  return 1;
}

/** Regroupe tous les goûts partageant exactement le même format logistique. */
export function groupesConditionnementPostalInvalides(
  lignes: LigneConditionnementPostal[],
): GroupeConditionnementPostalInvalide[] {
  const groupes = new Map<
    string,
    Omit<GroupeConditionnementPostalInvalide, "manque">
  >();
  for (const ligne of lignes) {
    if (!ligne.contenant || !ligne.packaging) continue;
    const multiple = multiplePourContenant(ligne.contenant);
    if (multiple <= 1) continue;
    const cle = `${ligne.contenant.trim().toLowerCase()}\u0000${ligne.packaging.trim().toLowerCase()}`;
    const groupe = groupes.get(cle);
    if (groupe) groupe.quantite += ligne.quantite;
    else
      groupes.set(cle, {
        contenant: ligne.contenant,
        packaging: ligne.packaging,
        quantite: ligne.quantite,
        multiple,
      });
  }
  return [...groupes.values()]
    .filter((groupe) => groupe.quantite % groupe.multiple !== 0)
    .map((groupe) => ({
      ...groupe,
      manque: groupe.multiple - (groupe.quantite % groupe.multiple),
    }));
}
