export interface PatternLibraryItem {
  id: string;
  title: string;
  category: string;
}

export function groupPatternLibrary(
  items: PatternLibraryItem[]
): Record<string, PatternLibraryItem[]> {
  return items.reduce<Record<string, PatternLibraryItem[]>>(
    (accumulator, item) => {
      const bucket = accumulator[item.category] ?? [];
      bucket.push(item);
      accumulator[item.category] = bucket;
      return accumulator;
    },
    {}
  );
}
