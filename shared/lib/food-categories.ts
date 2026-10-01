// Preset food categories, in the order the food picker shows them. Stored on ingredients.category
// by key, so labels can change without touching data.
export const FOOD_CATEGORIES = [
  { key: 'bread', en: 'Bread & bakery', ar: 'خبز ومخبوزات' },
  { key: 'dairy', en: 'Eggs & dairy', ar: 'بيض وألبان' },
  { key: 'cheese', en: 'Cheese', ar: 'أجبان' },
  { key: 'meat', en: 'Meat & poultry', ar: 'لحوم ودواجن' },
  { key: 'fish', en: 'Fish & seafood', ar: 'أسماك ومأكولات بحرية' },
  { key: 'grains', en: 'Rice, pasta & grains', ar: 'أرز ومكرونة وحبوب' },
  { key: 'legumes', en: 'Legumes', ar: 'بقوليات' },
  { key: 'veg', en: 'Vegetables', ar: 'خضروات' },
  { key: 'fruit', en: 'Fruit', ar: 'فاكهة' },
  { key: 'nuts', en: 'Nuts & seeds', ar: 'مكسرات وبذور' },
  { key: 'pantry', en: 'Oils, spreads & sauces', ar: 'زيوت وصوصات ومحليات' },
  { key: 'protein', en: 'Protein products', ar: 'منتجات بروتين' },
  { key: 'snacks', en: 'Snacks & sweets', ar: 'سناكس وحلويات' },
  { key: 'drinks', en: 'Drinks', ar: 'مشروبات' },
] as const

export type FoodCategory = typeof FOOD_CATEGORIES[number]['key']
