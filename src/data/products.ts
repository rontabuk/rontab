export const categories = [
  {
    id: "kitchen",
    name: "Kitchen",
    image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=85",
    imageAlt: "A considered coffee setup in a warmly lit kitchen",
  },
  {
    id: "tableware",
    name: "Tableware",
    image: "https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&w=900&q=85",
    imageAlt: "Handmade ceramic tableware in earthy tones",
  },
  {
    id: "textiles",
    name: "Textiles",
    image: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=900&q=85",
    imageAlt: "Softly layered natural textiles in a considered home",
  },
  {
    id: "storage",
    name: "Storage",
    image: "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=900&q=85",
    imageAlt: "Warm wood and woven details in a home interior",
  },
  {
    id: "living",
    name: "Living",
    image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85",
    imageAlt: "A warmly lit living space with a sculptural table lamp",
  },
] as const;

export type CategoryId = (typeof categories)[number]["id"];
export type ProductOverlayTone = "ceramic" | "linen" | "glass" | "coffee" | "woven" | "lamp" | "oak";
export type ProductCategory = {
  id: string;
  name: string;
  image: string;
  imageAlt: string;
};

export type Product = {
  slug: string;
  name: string;
  category: string;
  price: number | null;
  addedAt: string;
  description: string;
  image: string;
  imageAlt: string;
  maker: string;
  makerImage: string;
  overlayTone: ProductOverlayTone;
  detail: string;
  externalUrl: string;
  note?: string;
};

const photo = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1000&q=85`;
const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

export const editorialImage =
  "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1800&q=90";

export const products: Product[] = [
  {
    slug: "morrow-stoneware-pitcher",
    name: "Morrow stoneware pitcher",
    category: "tableware",
    price: 42,
    addedAt: hoursAgo(12),
    description: "A softly sculptural pourer for water, stems, or the middle of the table.",
    image: photo("photo-1578749556568-bc2c40e68b61"),
    imageAlt: "Handmade stoneware ceramics in a warm neutral glaze",
    maker: "Morrow Objects",
    makerImage: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=96&h=96&q=80",
    overlayTone: "ceramic",
    detail: "A small-batch ceramic form with a generous handle and a quietly tactile glaze. Each sample piece has the gentle variation of a handmade object.",
    externalUrl: "https://example.com/products/morrow-stoneware-pitcher",
    note: "Sample listing · illustrative image",
  },
  {
    slug: "field-notes-linen-apron",
    name: "Field Notes linen apron",
    category: "textiles",
    price: 38,
    addedAt: hoursAgo(31),
    description: "Washed linen, a useful front pocket, and ties that sit just right.",
    image: photo("photo-1600210492486-724fe5c67fb0"),
    imageAlt: "A softly layered interior with natural textiles",
    maker: "Field Notes Studio",
    makerImage: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=96&h=96&q=80",
    overlayTone: "linen",
    detail: "Cut from a considered linen blend and designed to soften with use. This fictional listing is a visual example only; no maker or item is available to purchase.",
    externalUrl: "https://example.com/products/field-notes-linen-apron",
  },
  {
    slug: "still-life-ripple-glasses",
    name: "Still Life ripple glasses",
    category: "tableware",
    price: 32,
    addedAt: hoursAgo(67),
    description: "Everyday tumblers with a fine ripple and a pleasing hand feel.",
    image: photo("photo-1494438639946-1ebd1d20bf85"),
    imageAlt: "Coffee and everyday glassware arranged on a tabletop",
    maker: "Still Life Supply",
    makerImage: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=96&h=96&q=80",
    overlayTone: "glass",
    detail: "A set of four imagined glasses with a light-catching ribbed profile. Product details and pricing are demonstration content.",
    externalUrl: "https://example.com/products/still-life-ripple-glasses",
  },
  {
    slug: "northline-pour-over-kettle",
    name: "Northline pour-over kettle",
    category: "kitchen",
    price: 86,
    addedAt: hoursAgo(91),
    description: "A balanced, precise pour for slow mornings and strong coffee.",
    image: photo("photo-1495474472287-4d71bcdd2085"),
    imageAlt: "A carefully prepared coffee beside a pour-over setup",
    maker: "Northline Workshop",
    makerImage: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=96&h=96&q=80",
    overlayTone: "coffee",
    detail: "Designed in our sample catalogue around a steady handle and a controlled spout. The listed price is fictional and is not an offer for sale.",
    externalUrl: "https://example.com/products/northline-pour-over-kettle",
    note: "Editor's pick",
  },
  {
    slug: "common-ground-woven-basket",
    name: "Common Ground woven basket",
    category: "storage",
    price: 29,
    addedAt: hoursAgo(118),
    description: "A generous catch-all for market finds, tea towels, or the hallway.",
    image: photo("photo-1600210492486-724fe5c67fb0"),
    imageAlt: "A warmly furnished room with woven, natural textures",
    maker: "Common Ground Home",
    makerImage: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=96&h=96&q=80",
    overlayTone: "woven",
    detail: "This fictional basket is shown as an example of the practical, well-made home pieces Rontab will be designed to feature.",
    externalUrl: "https://example.com/products/common-ground-woven-basket",
  },
  {
    slug: "soft-hour-table-lamp",
    name: "Soft Hour table lamp",
    category: "living",
    price: 74,
    addedAt: hoursAgo(143),
    description: "A gentle pool of light for the end of the day.",
    image: photo("photo-1507473885765-e6ed057f782c"),
    imageAlt: "A warm table lamp creating a soft pool of evening light",
    maker: "Soft Hour Objects",
    makerImage: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=96&h=96&q=80",
    overlayTone: "lamp",
    detail: "A fictional lamp with a simple silhouette, included to demonstrate the breadth of the discovery catalogue. No retail listing is connected.",
    externalUrl: "https://example.com/products/soft-hour-table-lamp",
  },
  {
    slug: "daymark-oak-serving-board",
    name: "Daymark oak serving board",
    category: "kitchen",
    price: 34,
    addedAt: hoursAgo(176),
    description: "A sturdy, honest board that earns its place on the counter.",
    image: photo("photo-1494438639946-1ebd1d20bf85"),
    imageAlt: "A calm tabletop arranged with coffee and everyday objects",
    maker: "Daymark Workshop",
    makerImage: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=96&h=96&q=80",
    overlayTone: "oak",
    detail: "A made-up serving board in an imagined oiled oak finish. All items and prices in this release are placeholders.",
    externalUrl: "https://example.com/products/daymark-oak-serving-board",
  },
  {
    slug: "good-weather-cotton-tea-towels",
    name: "Good Weather cotton tea towels",
    category: "textiles",
    price: 24,
    addedAt: hoursAgo(204),
    description: "A pair of useful cloths in a quietly cheerful woven check.",
    image: photo("photo-1600210492486-724fe5c67fb0"),
    imageAlt: "A naturally textured interior with softly layered fabrics",
    maker: "Good Weather Textile Co.",
    makerImage: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=96&h=96&q=80",
    overlayTone: "linen",
    detail: "A fictional pair of cotton towels created for the sample catalogue. The imagery is illustrative and does not depict a specific product.",
    externalUrl: "https://example.com/products/good-weather-cotton-tea-towels",
  },
];

export function formatPrice(price: number | null) {
  if (price === null) return "Price on request";

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(price);
}