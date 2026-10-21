/**
 * 8 人座位绕椭圆均分，底部你固定；
 * 顶部正中留空给荷官栏，右侧不再贴着你。
 */
export const SEAT_POS: { x: number; y: number }[] = [
  { x: 50, y: 91 }, // 0 你（正下）
  { x: 20, y: 78 }, // 1 左下
  { x: 6, y: 52 }, // 2 正左
  { x: 14, y: 30 }, // 3 左上（偏侧，不挡荷官）
  { x: 86, y: 30 }, // 4 右上（偏侧，不挡荷官）
  { x: 94, y: 52 }, // 5 正右
  { x: 80, y: 78 }, // 6 右下
  { x: 72, y: 88 }, // 7 右下偏下（拉开与你的间距）
];

export const PERSONA_LABEL: Record<string, string> = {
  standard: "标准",
  tight: "紧弱",
  loose: "松凶",
  calling: "跟注站",
  bluff: "诈唬狂",
};
