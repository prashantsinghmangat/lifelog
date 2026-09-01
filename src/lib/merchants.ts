/** Word -> category map for expense categorisation. Extend by adding words. */
export const MERCHANTS: Record<string, readonly string[]> = {
  food: [
    'swiggy',
    'zomato',
    'blinkit',
    'zepto',
    'dominos',
    'chai',
    'lunch',
    'dinner',
    'breakfast',
    'groceries',
  ],
  transport: ['uber', 'ola', 'rapido', 'metro', 'petrol', 'fuel', 'auto', 'cab'],
  shopping: ['amazon', 'flipkart', 'myntra', 'shoes', 'clothes'],
  bills: ['rent', 'electricity', 'internet', 'recharge', 'jio', 'airtel'],
  health: ['pharmacy', 'apollo', 'doctor', 'dentist', 'medicine', 'gym'],
}

const lookup = new Map<string, string>()
for (const [category, words] of Object.entries(MERCHANTS)) {
  for (const word of words) lookup.set(word, category)
}

export function categoryForWord(word: string): string | undefined {
  return lookup.get(word.toLowerCase())
}
