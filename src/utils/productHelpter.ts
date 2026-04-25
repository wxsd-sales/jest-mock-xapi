export const products = {
  bandai: "Desk Mini",
  barents: "Codec Pro",
  barents_70d: "Room 70 Dual G2",
  barents_70i: "Room 70 Panorama",
  barents_70s: "Room 70 Single G2",
  barents_82i: "Room Panorama",
  brooklyn: "Room Bar Pro",
  darling_10_55: "Board 55",
  darling_10_70: "Board 70",
  darling_15_55: "Board 55S",
  darling_15_70: "Board 70S",
  darling_15_85: "Board 85S",
  davinci: "Room Bar",
  felix_55: "Board Pro 55 G2",
  felix_75: "Board Pro 75 G2",
  helix_55: "Board Pro 55",
  helix_75: "Board Pro 75",
  havella: "Room Kit Mini",
  hopen: "Room Kit",
  millennium: "Codec EQ",
  octavio: "Desk",
  pictoris: "Desk Pro G2",
  polaris: "Desk Pro",
  spitsbergen: "Room 55",
  svea: "Codec Plus",
  svea_55d: "Room 55 Dual",
  svea_70d: "Room 70 Dual",
  svea_70s: "Room 70 Single",
  tyne: "Codec Pro G2",
  vecchio: "Navigator",
} as const;

export type ProductCode = keyof typeof products;

const productPlatformToCodes = new Map<string, string[]>();

for (const [code, productPlatform] of Object.entries(products)) {
  const existingCodes = productPlatformToCodes.get(productPlatform) ?? [];
  existingCodes.push(code);
  productPlatformToCodes.set(productPlatform, existingCodes);
}

export function getProductCodes(productPlatformOrCode: string) {
  if (Object.hasOwn(products, productPlatformOrCode)) {
    return [productPlatformOrCode];
  }

  return productPlatformToCodes.get(productPlatformOrCode) ?? [];
}
