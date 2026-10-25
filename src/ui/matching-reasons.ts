import type { MatchingReason } from "../domain/matching";

const reasons: Record<MatchingReason, [string, string]> = {
  resolved: ["Tuote vastaa pyyntöäsi.", "The product matches your request."],
  approved: [
    "Hyväksyit tämän tuotteen nykyiseen listaan.",
    "You approved this product for the current list.",
  ],
  "empty-search": [
    "Kaupan hausta ei löytynyt vaihtoehtoja.",
    "The store search found no alternatives.",
  ],
  "bounded-out": [
    "Kaupan haku ei ehtinyt tai onnistunut tälle riville. Päivitä hinnat hakeaksesi sen uudelleen.",
    "The store search did not reach or answer for this row. Update prices to search it again.",
  ],
  identity: [
    "Tuotteen kauppatiedot eivät vastaa nykyistä kauppaa.",
    "The product does not belong to the current store.",
  ],
  "invalid-evidence": [
    "Tuotetyypin tiedot eivät ole kelvollisia.",
    "The product type evidence is invalid.",
  ],
  category: [
    "Tuote kuuluu eri ruokaryhmään.",
    "The product belongs to a different food category.",
  ],
  family: [
    "Tuote on eri tuotetyyppiä kuin pyyntösi.",
    "The product is a different type from your request.",
  ],
  "unknown-category": [
    "Tuotteen ruokaryhmää ei voitu varmistaa.",
    "The product's food category could not be verified.",
  ],
  "unknown-family": [
    "Tuotetyyppiä ei voitu varmistaa.",
    "The product type could not be verified.",
  ],
  "unsupported-request": [
    "Pyydettyä ominaisuutta ei voida varmistaa nykyisistä tuotetiedoista.",
    "The requested attribute cannot be verified from the available product data.",
  ],
  "qualifier-conflict": [
    "Tuotteen ominaisuudet eivät vastaa vaadittua tyyppiä.",
    "The product attributes do not match the required type.",
  ],
  "qualifier-unknown": [
    "Vaadittua ominaisuutta ei ole vahvistettu tuotetiedoissa.",
    "A required attribute is not confirmed by the product data.",
  ],
  "constraint-conflict": [
    "Pyynnön ja vaaditun tuotetyypin ehdot ovat ristiriidassa.",
    "The request conflicts with the required product type.",
  ],
  excluded: [
    "Tuote on kotitalouden poissulkemissa tuotteissa.",
    "The product matches a household exclusion.",
  ],
  "dietary-evidence": [
    "Ruokavalioon sopivuutta ei voitu varmistaa.",
    "Suitability for the dietary restriction could not be verified.",
  ],
  "preference-missing": [
    "Muistettua suosittua tyyppiä ei löytynyt. Muu tyyppi vaatii hyväksyntäsi.",
    "The remembered preferred type was not found. Another type needs your approval.",
  ],
  "default-review": [
    "Tuotetyyppi tarvitsee hyväksyntäsi.",
    "This product type needs your approval.",
  ],
  stock: [
    "Tuotteen saatavuutta ei ole vahvistettu.",
    "Product availability is not confirmed.",
  ],
  price: [
    "Tuotteen hintaa ei ole vahvistettu.",
    "The product price is not confirmed.",
  ],
  pack: ["Pakkauskokoa ei ole vahvistettu.", "The pack size is not confirmed."],
  unit: [
    "Tuotteen yksikkö ei vastaa tarvittavaa määrää.",
    "The product unit does not match the required amount.",
  ],
  name: [
    "Tuote ei vastaa pyydettyä ruokaa.",
    "The product does not match the requested food.",
  ],
  "owner-correction": [
    "Jätit tämän rivin ratkaisematta korjauksen yhteydessä.",
    "You left this row unresolved during a correction.",
  ],
};

export function matchingReasonLabel(
  reason: MatchingReason,
  language: string,
): string {
  return reasons[reason][language === "fi" ? 0 : 1];
}
