import { SKIN_PRICE } from "../config";

export type SkinType = "table" | "card" | "dealer";

export type SkinItem = {
  id: string;
  type: SkinType;
  name: string;
  price: number;
};

export const SKINS: SkinItem[] = [
  { id: "table_default", type: "table", name: "经典绿毡", price: 0 },
  { id: "table_night", type: "table", name: "午夜蓝桌", price: SKIN_PRICE.common },
  { id: "table_gold", type: "table", name: "金边牌桌", price: SKIN_PRICE.rare },
  { id: "card_default", type: "card", name: "经典牌背", price: 0 },
  { id: "card_ruby", type: "card", name: "红宝石背", price: SKIN_PRICE.common },
  { id: "card_ink", type: "card", name: "墨竹牌背", price: SKIN_PRICE.legend },
  { id: "dealer_default", type: "dealer", name: "日和", price: 0 },
  { id: "dealer_cool", type: "dealer", name: "春", price: SKIN_PRICE.common },
  { id: "dealer_queen", type: "dealer", name: "艾普西隆", price: SKIN_PRICE.rare },
];

export const DEFAULT_EQUIP = {
  table: "table_default",
  card: "card_default",
  dealer: "dealer_default",
};
